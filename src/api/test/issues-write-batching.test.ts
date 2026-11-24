/*
 * PROJ-870: issue create/update fold their independent writes (issue INSERT/UPDATE incl.
 * status_category, FTS delete+insert, custom-field upserts, activity, completion-report
 * comment, gate rejection) into one db.batch(), drop the post-write re-SELECTs and the
 * duplicate status lookup, and walk the parent's ancestors with one recursive CTE.
 *
 * The services are called directly with a ServiceCtx so the counts exclude auth/rate-limit
 * middleware (the AC's "excluding auth"). A D1 round trip is counted the way D1 bills it:
 * each statement executed on its own counts once, and a whole db.batch() counts once
 * however many statements it carries (same counter as file-claims-batching.test.ts).
 *
 * Measured with this counter (before -> after this ticket): create 15 -> 6, update 15 -> 6,
 * review transition with completion report 7 -> 4, and the parent walk no longer grows
 * with depth (a 4-ancestor parent cost 3 more round trips than a 1-ancestor one; now equal).
 */
import { Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { createIssue, updateIssue } from '#commands/issues.ts'
import type { ServiceCtx } from '#commands/types.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  seedAgentLease,
  seedCustomFieldDef,
  seedIssue,
  seedProjectFixture,
  seedTaskStatus,
  seedTaskType,
} from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

const trackD1RoundTrips = function trackD1RoundTrips() {
  let count = 0
  const origPrepare = env.DB.prepare.bind(env.DB)
  const origBatch = env.DB.batch.bind(env.DB)
  const EXEC_METHODS = new Set(['run', 'all', 'get', 'first', 'raw'])

  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (!Predicate.isFunction(value)) {
          return value
        }
        if (prop === 'bind') {
          return (...args: unknown[]) =>
            wrapStmt((value as (...a: unknown[]) => D1PreparedStatement).apply(target, args))
        }
        if (Predicate.isString(prop) && EXEC_METHODS.has(prop)) {
          return (...args: unknown[]) => {
            count++
            return (value as (...a: unknown[]) => unknown).apply(target, args)
          }
        }
        return value.bind(target)
      },
    })

  vi.spyOn(env.DB, 'prepare').mockImplementation((q: string) => wrapStmt(origPrepare(q)))
  vi.spyOn(env.DB, 'batch').mockImplementation((stmts: D1PreparedStatement[]) => {
    count++
    return origBatch(stmts)
  })

  return { count: () => count }
}

type Fixture = Awaited<ReturnType<typeof seedProjectFixture>>

const ownerCtx = function ownerCtx(f: Fixture): ServiceCtx {
  return {
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    workspaceId: f.workspaceId,
    userId: f.userId,
    role: 'owner',
  }
}

// ValidationError's message is generic; the human-readable reason is in issues.formErrors.
const formErrorOf = async function formErrorOf(p: Promise<unknown>): Promise<string[]> {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as { issues?: { formErrors: string[] } } | null
  expect(err, 'expected the call to be rejected').not.toBeNull()
  return err?.issues?.formErrors ?? []
}

const seedChain = async function seedChain(f: Fixture, length: number): Promise<string[]> {
  const ids: string[] = []
  let parentId: string | undefined
  for (let index = 0; index < length; index++) {
    const { id } = await seedIssue(f.workspaceId, f.projectId, f.userId, {
      title: `L${index}`,
      parentId,
    })
    ids.push(id)
    parentId = id
  }
  return ids
}

describe('covers PROJ-870: issue write batching', () => {
  let f: Fixture
  let ctx: ServiceCtx

  beforeEach(async () => {
    f = await seedProjectFixture({ role: 'owner' })
    ctx = ownerCtx(f)
  })
  afterEach(() => vi.restoreAllMocks())

  test('createIssue with parent chain, status, type and custom fields uses ≤8 D1 round trips', async () => {
    const chain = await seedChain(f, 4) // parent has 3 ancestors → the ancestor walk runs
    const status = await seedTaskStatus(f.workspaceId, { key: 'doing', category: 'in_progress' })
    const type = await seedTaskType(f.workspaceId, { key: 'task' })
    await seedCustomFieldDef(f.workspaceId, { key: 'points', type: 'number' })
    await seedCustomFieldDef(f.workspaceId, { key: 'team' })

    const tracker = trackD1RoundTrips()
    const created = await createIssue(ctx, {
      projectId: f.projectId,
      title: 'Batched create',
      body: 'hello body',
      parentId: chain[3],
      statusId: status.id,
      typeId: type.id,
      customFields: { points: 3, team: 'core' },
    })
    const roundTrips = tracker.count()
    vi.restoreAllMocks()

    expect(roundTrips).toBeLessThanOrEqual(8)

    // Behaviour is unchanged: number comes back (via RETURNING), and every write landed.
    expect(created.number).toBe(5)
    const row = await env.DB.prepare(
      'SELECT number, status, status_id, status_category, parent_id, type_id FROM issues WHERE id = ?',
    )
      .bind(created.id)
      .first()
    expect(row).toEqual({
      number: 5,
      status: 'doing',
      status_id: status.id,
      status_category: 'in_progress',
      parent_id: chain[3],
      type_id: type.id,
    })
    const fts = await env.DB.prepare('SELECT title, body FROM issues_fts WHERE issue_id = ?').bind(created.id).first()
    expect(fts).toEqual({ body: 'hello body', title: 'Batched create' })
    const cf = await env.DB.prepare(
      `SELECT d.key, v.value FROM custom_field_values v
			 JOIN custom_field_definitions d ON d.id = v.field_id WHERE v.issue_id = ? ORDER BY d.key`,
    )
      .bind(created.id)
      .all()
    expect(cf.results).toEqual([
      { key: 'points', value: '3' },
      { key: 'team', value: 'core' },
    ])
    const activity = await env.DB.prepare("SELECT action FROM activity WHERE entity_id = ? AND entity_type = 'issue'")
      .bind(created.id)
      .all()
    expect(activity.results).toEqual([{ action: 'created' }])
  })

  test('updateIssue changing title, body, status, parent and custom fields uses ≤7 D1 round trips', async () => {
    const chain = await seedChain(f, 4)
    const issue = await seedIssue(f.workspaceId, f.projectId, f.userId, { title: 'Before' })
    const done = await seedTaskStatus(f.workspaceId, { key: 'shipped', category: 'done' })
    await seedCustomFieldDef(f.workspaceId, { key: 'points', type: 'number' })

    const tracker = trackD1RoundTrips()
    await updateIssue(ctx, issue.id, {
      title: 'After',
      body: 'new body',
      statusId: done.id,
      parentId: chain[3],
      customFields: { points: 8 },
    })
    const roundTrips = tracker.count()
    vi.restoreAllMocks()

    expect(roundTrips).toBeLessThanOrEqual(7)

    const row = await env.DB.prepare(
      'SELECT title, status, status_category, parent_id, completed_at, done_at FROM issues WHERE id = ?',
    )
      .bind(issue.id)
      .first<Record<string, unknown>>()
    expect(row).toMatchObject({
      title: 'After',
      status: 'shipped',
      status_category: 'done',
      parent_id: chain[3],
    })
    expect(row?.completed_at).not.toBeNull()
    expect(row?.done_at).not.toBeNull()
    const fts = await env.DB.prepare('SELECT title, body FROM issues_fts WHERE issue_id = ?').bind(issue.id).all()
    expect(fts.results).toEqual([{ body: 'new body', title: 'After' }])
    const cf = await env.DB.prepare('SELECT value FROM custom_field_values WHERE issue_id = ?').bind(issue.id).first()
    expect(cf).toEqual({ value: '8' })
  })

  test('title-only update reindexes FTS with the untouched body (no re-SELECT needed)', async () => {
    const created = await createIssue(ctx, {
      projectId: f.projectId,
      title: 'Original',
      body: 'kept body',
    })
    await updateIssue(ctx, created.id, { title: 'Renamed' })
    const fts = await env.DB.prepare('SELECT title, body FROM issues_fts WHERE issue_id = ?').bind(created.id).all()
    expect(fts.results).toEqual([{ body: 'kept body', title: 'Renamed' }])
  })

  test('entering review with a completion report batches the comment; review→in_progress batches the gate rejection', async () => {
    const issue = await seedIssue(f.workspaceId, f.projectId, f.userId, {
      title: 'Agent work',
      status: 'in_progress',
    })
    await seedAgentLease(f.workspaceId, issue.id)

    const tracker = trackD1RoundTrips()
    await updateIssue(ctx, issue.id, {
      status: 'in_review',
      completionReport: { summary: 'Did it', verification: 'pnpm test' },
    })
    const toReview = tracker.count()
    vi.restoreAllMocks()
    // 7 before PROJ-870 (comment + its visibility re-check were separate round trips),
    // 4 after; ≤5 keeps this discriminating rather than just restating the ≤7 budget.
    expect(toReview).toBeLessThanOrEqual(5)

    const comments = await env.DB.prepare('SELECT body FROM issue_comments WHERE issue_id = ?')
      .bind(issue.id)
      .all<{ body: string }>()
    expect(comments.results).toHaveLength(1)
    expect(comments.results[0].body).toContain('**Summary:** Did it')

    await updateIssue(ctx, issue.id, { status: 'in_progress' })
    const rejections = await env.DB.prepare('SELECT COUNT(*) AS n FROM issue_gate_rejections WHERE issue_id = ?')
      .bind(issue.id)
      .first<{ n: number }>()
    expect(rejections?.n).toBe(1)
  })
})

describe('covers PROJ-870 review: completion report comment limit', () => {
  test('400s a completion report whose formatted comment exceeds the comment limit, writing nothing', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const issue = await seedIssue(testFixture.workspaceId, testFixture.projectId, testFixture.userId, {
      title: 'Long report',
      status: 'in_progress',
    })

    const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}`, {
      method: 'PATCH',
      headers: authHeaders(testFixture.token, testFixture.slug),
      body: JSON.stringify({
        status: 'in_review',
        completionReport: { summary: 's'.repeat(6000), verification: 'v'.repeat(4000) },
      }),
    })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/Completion report is too long/u)

    // The batch never ran: no status change, no comment.
    const row = await env.DB.prepare('SELECT status, completion_report_at FROM issues WHERE id = ?')
      .bind(issue.id)
      .first()
    expect(row).toEqual({ completion_report_at: null, status: 'in_progress' })
    const comments = await env.DB.prepare('SELECT COUNT(*) AS n FROM issue_comments WHERE issue_id = ?')
      .bind(issue.id)
      .first<{ n: number }>()
    expect(comments?.n).toBe(0)
  })
})

describe('covers PROJ-870: recursive-CTE ancestor walk', () => {
  let f: Fixture
  let ctx: ServiceCtx

  beforeEach(async () => {
    f = await seedProjectFixture({ role: 'owner' })
    ctx = ownerCtx(f)
  })
  afterEach(() => vi.restoreAllMocks())

  test('walks a 4-ancestor chain in one query regardless of depth', async () => {
    const shallow = await seedChain(f, 2) // parent has 1 ancestor
    const deep = await seedChain(f, 5) // parent has 4 ancestors (the deepest allowed)

    let tracker = trackD1RoundTrips()
    await createIssue(ctx, { projectId: f.projectId, title: 'shallow', parentId: shallow[1] })
    const shallowTrips = tracker.count()
    vi.restoreAllMocks()

    tracker = trackD1RoundTrips()
    await createIssue(ctx, { projectId: f.projectId, title: 'deep', parentId: deep[4] })
    const deepTrips = tracker.count()
    vi.restoreAllMocks()

    // Per-level SELECTs would make the deep create 3 round trips dearer than the shallow one.
    expect(deepTrips).toBe(shallowTrips)
  })

  test('rejects a parent that already has 5 ancestors, allows 4', async () => {
    const chain = await seedChain(f, 6)
    await expect(
      formErrorOf(createIssue(ctx, { projectId: f.projectId, title: 'too deep', parentId: chain[5] })),
    ).resolves.toEqual(['Maximum nesting depth (5) exceeded'])
    await expect(createIssue(ctx, { projectId: f.projectId, title: 'ok', parentId: chain[4] })).resolves.toMatchObject({
      number: expect.any(Number),
    })
  })

  test("reports a cycle (not the depth cap) when the issue is the parent's 5th ancestor", async () => {
    // chain[0] is the 5th ancestor of chain[5] — the same step at which the cap fires.
    // The original loop checked the cycle before the cap on each step; so must the CTE.
    const chain = await seedChain(f, 6)
    await expect(formErrorOf(updateIssue(ctx, chain[0], { parentId: chain[5] }))).resolves.toEqual([
      'Setting this parent would create a cycle',
    ])
  })

  test('reports a cycle on a nearer ancestor, and rejects self-parenting', async () => {
    const chain = await seedChain(f, 3)
    await expect(formErrorOf(updateIssue(ctx, chain[0], { parentId: chain[2] }))).resolves.toEqual([
      'Setting this parent would create a cycle',
    ])
    await expect(formErrorOf(updateIssue(ctx, chain[0], { parentId: chain[0] }))).resolves.toEqual([
      'An issue cannot be its own parent',
    ])
  })

  test("does not walk into another workspace's issues", async () => {
    const other = await seedProjectFixture({ role: 'owner' })
    const foreign = await seedIssue(other.workspaceId, other.projectId, other.userId)
    await expect(createIssue(ctx, { projectId: f.projectId, title: 'x', parentId: foreign.id })).rejects.toThrow(
      'Parent issue not found',
    )
  })

  test('stops the walk at an ancestor link that leaves the workspace', async () => {
    /*
     * P (this workspace) has parent_id pointing at X in another workspace, and X sits
     * under 5 more foreign ancestors. Only in-workspace rows may be walked, so P has no
     * visible ancestors and a child under it is fine — counting the foreign chain would
     * wrongly hit the depth cap.
     */
    const other = await seedProjectFixture({ role: 'owner' })
    const foreignChain = await seedChain(other, 6)
    const issue = await seedIssue(f.workspaceId, f.projectId, f.userId, { title: 'P' })
    await env.DB.prepare('UPDATE issues SET parent_id = ? WHERE id = ?').bind(foreignChain[5], issue.id).run()

    await expect(
      createIssue(ctx, { projectId: f.projectId, title: 'child of P', parentId: issue.id }),
    ).resolves.toMatchObject({ number: expect.any(Number) })
  })
})
