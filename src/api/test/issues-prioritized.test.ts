/*
 * PROJ-859: get_prioritized_issues ranks in SQL. Parity with the previous in-memory
 * algorithm (reimplemented below as the reference) and a bounded query count.
 */

import { Iterable } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { checkDefinitionOfReady } from '#commands/definition-of-ready.ts'
import { getPrioritizedIssues } from '#commands/issues.ts'
import type { ServiceCtx } from '#commands/types.ts'

import { env } from './fixture-api.ts'
import { seedFixture, seedProject } from './helpers.ts'

const READY_BODY = 'Do the thing.\n\n## Acceptance criteria\n- [ ] it works\n\n## Scope\n`apps/api/src/x.ts`'
const NOT_READY_BODY = 'Something is off, look into it.'
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const
const PRIORITY_SCORE: Record<string, number> = { high: 3, low: 1, medium: 2, none: 0, urgent: 4 }

const seedWorkspaceWithIssues = async function seedWorkspaceWithIssues(n: number): Promise<{ ctx: ServiceCtx }> {
  const { workspace, user } = await seedFixture({ role: 'owner' })
  const project = await seedProject(workspace.id)
  const now = Math.floor(Date.now() / 1000)
  const ids: string[] = []
  const stmts: D1PreparedStatement[] = []
  for (let index = 0; index < n; index++) {
    const id = crypto.randomUUID()
    ids.push(id)
    // A deterministic spread: every 7th closed, every 5th in backlog, ~60% ready.
    const status = index % 7 === 0 ? 'done' : index % 5 === 0 ? 'backlog' : 'todo'
    stmts.push(
      env.DB.prepare(
        `INSERT INTO issues (id, workspace_id, project_id, number, title, body, status, priority,
				   labels, created_by_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
      ).bind(
        id,
        workspace.id,
        project.id,
        index + 1,
        `Issue ${index}`,
        index % 5 < 3 ? READY_BODY : NOT_READY_BODY,
        status,
        PRIORITIES[(index * 3) % 5],
        user.id,
        now,
        now,
      ),
    )
  }
  // Links: issue j points at issue (j*7 mod n) for the first third — uneven in-degrees.
  for (let j = 0; j < Math.floor(n / 3); j++) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO issue_links (id, workspace_id, source_issue_id, target_issue_id, type, created_by_id, created_at)
				 VALUES (?, ?, ?, ?, 'blocks', ?, ?)`,
      ).bind(crypto.randomUUID(), workspace.id, ids[j], ids[(j * 7) % n], user.id, now),
    )
  }
  // Story points on every 4th issue.
  const fieldId = crypto.randomUUID()
  stmts.push(
    env.DB.prepare(
      `INSERT INTO custom_field_definitions (id, workspace_id, project_id, key, label, type, created_at)
			 VALUES (?, ?, NULL, 'story_points', 'Story points', 'number', ?)`,
    ).bind(fieldId, workspace.id, now),
  )
  for (let index = 0; index < n; index += 4) {
    stmts.push(
      env.DB.prepare('INSERT INTO custom_field_values (issue_id, field_id, value) VALUES (?, ?, ?)').bind(
        ids[index],
        fieldId,
        String((index % 8) + 1),
      ),
    )
  }
  for (let k = 0; k < stmts.length; k += 90) {
    await env.DB.batch(stmts.slice(k, k + 90))
  }

  const ctx: ServiceCtx = {
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  }
  return { ctx }
}

/*
 * The pre-PROJ-859 algorithm: load every open issue, score in memory, stable-sort,
 * then apply the definition-of-ready gate. Ties resolve in insertion (rowid) order.
 */
const reference = async function reference(
  ctx: ServiceCtx,
  includeBacklog: boolean,
): Promise<{ id: string; score: number; ready: boolean }[]> {
  const { results: open } = await env.DB.prepare(
    `SELECT id, priority, body, rowid AS rid FROM issues
		 WHERE workspace_id = ? AND status NOT IN ('done', 'cancelled') ${includeBacklog ? '' : "AND status != 'backlog'"}
		 ORDER BY rowid`,
  )
    .bind(ctx.workspaceId)
    .all<{ id: string; priority: string; body: string }>()
  const { results: links } = await env.DB.prepare('SELECT target_issue_id FROM issue_links WHERE workspace_id = ?')
    .bind(ctx.workspaceId)
    .all<{ target_issue_id: string }>()
  const { results: sps } = await env.DB.prepare(
    `SELECT v.issue_id, CAST(v.value AS REAL) AS sp FROM custom_field_values v
		 JOIN custom_field_definitions d ON d.id = v.field_id WHERE d.workspace_id = ?`,
  )
    .bind(ctx.workspaceId)
    .all<{ issue_id: string; sp: number }>()

  const openIds = new Set(open.map((o) => o.id))
  const inDegree: Record<string, number> = {}
  Iterable.forEach(links, (l) => {
    if (openIds.has(l.target_issue_id)) {
      inDegree[l.target_issue_id] = (inDegree[l.target_issue_id] ?? 0) + 1
    }
  })
  const storyPoints: Record<string, number> = {}
  Iterable.forEach(sps, (s) => {
    if (s.sp > 0) {
      storyPoints[s.issue_id] = s.sp
    }
  })
  const maxIn = Math.max(...open.map((o) => inDegree[o.id] ?? 0), 1)

  return open
    .map((o) => {
      const score =
        0.4 * ((inDegree[o.id] ?? 0) / maxIn) +
        0.4 * ((PRIORITY_SCORE[o.priority] ?? 0) / 4) +
        0.2 * (1 / (storyPoints[o.id] ?? 1))
      return { id: o.id, score, ready: checkDefinitionOfReady(o.body).ready }
    })
    .sort((left, right) => right.score - left.score)
}

describe('covers PROJ-859: prioritization parity with the in-memory algorithm', () => {
  test.each([
    { includeNotReady: false, includeBacklog: true },
    { includeNotReady: true, includeBacklog: true },
    { includeNotReady: false, includeBacklog: false },
  ])('matches for 220 issues (%o)', async (opts) => {
    const { ctx } = await seedWorkspaceWithIssues(220)
    const expected = await reference(ctx, opts.includeBacklog)
    const limit = 25

    const got = (await getPrioritizedIssues(ctx, { limit, ...opts })) as {
      issues: { id: string; _score: number; needsGrooming?: true }[]
      droppedNotReady: number
    }

    const wanted = opts.includeNotReady ? expected : expected.filter((e) => e.ready)
    expect(got.issues.map((issue) => issue.id)).toEqual(wanted.slice(0, limit).map((e) => e.id))
    got.issues.forEach((issue, index) => {
      expect(issue._score).toBeCloseTo(wanted[index].score, 10)
      expect(issue.needsGrooming === true).toBe(!wanted[index].ready)
    })
    expect(got.droppedNotReady).toBe(opts.includeNotReady ? 0 : expected.filter((e) => !e.ready).length)
  })
})

describe('covers PROJ-859: bounded query count', () => {
  afterEach(() => vi.restoreAllMocks())

  test('limit=10 over 1,000 open issues takes <= 10 D1 queries once rows are healed', async () => {
    const { ctx } = await seedWorkspaceWithIssues(1000)
    await getPrioritizedIssues(ctx, { limit: 10 }) // first call heals dor_* in batches

    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM issues WHERE workspace_id = ? AND dor_ready IS NULL')
      .bind(ctx.workspaceId)
      .first<{ n: number }>()
    expect(stored?.n).toBe(0)

    let prepares = 0
    const orig = env.DB.prepare.bind(env.DB)
    vi.spyOn(env.DB, 'prepare').mockImplementation((q: string) => {
      prepares++
      return orig(q)
    })
    const res = (await getPrioritizedIssues(ctx, { limit: 10 })) as { issues: unknown[] }
    expect(res.issues).toHaveLength(10)
    expect(prepares).toBeLessThanOrEqual(10)
  })

  test('an issue body update keeps dor_ready current', async () => {
    const { ctx } = await seedWorkspaceWithIssues(6)
    await getPrioritizedIssues(ctx, { limit: 10 })
    const row = await env.DB.prepare('SELECT id FROM issues WHERE workspace_id = ? AND dor_ready = 0 LIMIT 1')
      .bind(ctx.workspaceId)
      .first<{ id: string }>()
    const { updateIssue } = await import('#commands/issues.ts')
    await updateIssue(ctx, row?.id as string, { body: READY_BODY })
    const after = await env.DB.prepare('SELECT dor_ready, dor_missing FROM issues WHERE id = ?')
      .bind(row?.id)
      .first<{ dor_ready: number; dor_missing: string }>()
    expect(after).toEqual({ dor_missing: '[]', dor_ready: 1 })
  })
})

/*
 * PROJ-920: the MCP argument validator lets through the string forms the services coerce
 * ("false", "5"), so get_prioritized_issues must read them the same way — not treat the
 * string "false" as true.
 */
describe('covers PROJ-920: string flags and limit are coerced like BooleanQueryParam / z.coerce', () => {
  test('includeBacklog: "false" and limit: "3" behave like false and 3', async () => {
    const { ctx } = await seedWorkspaceWithIssues(40)
    const asBool = (await getPrioritizedIssues(ctx, {
      limit: 3,
      includeBacklog: false,
      includeNotReady: true,
    })) as { issues: { id: string }[] }
    const asString = (await getPrioritizedIssues(ctx, {
      limit: '3',
      includeBacklog: 'false',
      includeNotReady: '1',
    })) as { issues: { id: string }[] }
    expect(asString.issues.map((issue) => issue.id)).toEqual(asBool.issues.map((issue) => issue.id))
    expect(asString.issues).toHaveLength(3)
  })
})
