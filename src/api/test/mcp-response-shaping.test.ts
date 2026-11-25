import { Schema, String, Predicate, Iterable } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vite-plus/test'

import { capPage, shapeIssue, splitShapeOpts, toPage } from '#api/mcp/serialize.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
/*
 * PROJ-891: MCP response shaping — summary/full views, fields=, no nulls or internal ids,
 * one `{items, next}` pagination shape, and a hard per-result size cap.
 */
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'
import { JSON_NULL } from '#tests/json-null.ts'
import { runIndexedInOrder, runInOrder } from '#tests/run-effect.ts'

import { env } from './fixture-api.ts'
import { seedIssue, seedProjectFixture } from './helpers.ts'
import { fetchNativeMcpTool } from './native-fetch.ts'
import type { McpToolRequest } from './native-fetch.ts'
import {
  ItemsResponse,
  JsonRecordResponse,
  McpRpcResponse,
  MessageBodiesResponse,
  RpcTextResponse,
  SlugResponse,
  parseNativeMcpText,
  readNativeJson,
  readNativeMcpResultText,
} from './response-json.ts'

describe('covers PROJ-891: serializer (unit)', () => {
  const raw = {
    id: 'i1',
    workspace_id: 'w',
    project_id: 'p',
    number: 7,
    title: 'T',
    status: 'todo',
    priority: 'high',
    labels: '["a","b"]',
    parent_id: SQL_NULL,
    assignee_id: SQL_NULL,
    assignee_name: SQL_NULL,
    type_id: 't',
    type_key: 'bug',
    type_name: 'Bug',
    status_id: 's',
    status_key: 'todo',
    status_name: 'Todo',
    status_category: 'todo',
    created_by_id: 'u',
    author_kind: SQL_NULL,
    needs_audit: false,
    completed_at: SQL_NULL,
    sprint_id: SQL_NULL,
    created_at: 1,
    updated_at: 2,
    project_key: 'PROJ',
    project_name: 'Projektor',
    links: [],
    customFields: [],
  }

  test('full view drops nulls, empty arrays, false defaults and internal ids; parses labels; adds ref/type', () => {
    expect.hasAssertions()
    const out = shapeIssue(raw, {})
    expect(out.ref).toBe('PROJ-7')
    expect(out.type).toBe('bug')
    expect(out.labels).toStrictEqual(['a', 'b'])
    Iterable.forEach(
      [
        'workspace_id',
        'project_id',
        'type_id',
        'status_id',
        'created_by_id',
        'project_key',
        'project_name',
        'type_key',
        'type_name',
        'status_key',
        'status_name',
        'parent_id',
        'assignee_id',
        'needs_audit',
        'links',
        'customFields',
        'sprint_id',
        'completed_at',
      ],
      (k) => {
        expect(out, k).not.toHaveProperty(k)
      },
    )
    expect(out.status).toBe('todo')
    expect(out.priority).toBe('high')
  })

  test('summary view is {ref,title,status,priority,type,parent?,assignee?,updated}', () => {
    expect(shapeIssue(raw, { view: 'summary' })).toStrictEqual({
      priority: 'high',
      ref: 'PROJ-7',
      status: 'todo',
      title: 'T',
      type: 'bug',
      updated: 2,
    })
    expect(shapeIssue({ ...raw, parent_id: 'P', assignee_name: 'Ann' }, { view: 'summary' })).toMatchObject({
      assignee: 'Ann',
      parent: 'P',
    })
  })

  test('verbose returns the raw row; fields picks (incl. derived ref) with null for absent values', () => {
    expect(shapeIssue(raw, { verbose: true })).toBe(raw)
    expect(shapeIssue(raw, { fields: ['ref', 'assignee_id', 'updated'] })).toStrictEqual({
      assignee_id: JSON_NULL,
      ref: 'PROJ-7',
      updated: 2,
    })
  })

  test('fields accepts a comma-separated string and rejects unknown names', () => {
    expect(splitShapeOpts({ fields: 'ref, title' }).fields).toStrictEqual(['ref', 'title'])
    const invalidOption: unknown = expect.stringContaining('Invalid option')
    const invalidFields: unknown = expect.objectContaining({
      issues: { fieldErrors: { fields: [invalidOption] }, formErrors: [] },
      message: 'Validation failed',
    })
    const invalidView: unknown = expect.objectContaining({
      issues: { fieldErrors: { view: [invalidOption] }, formErrors: [] },
      message: 'Validation failed',
    })
    expect(() => splitShapeOpts({ fields: 'ref,nope' })).toThrow(invalidFields)
    expect(() => splitShapeOpts({ view: 'tiny' })).toThrow(invalidView)
  })

  test('toPage omits next when there is no further page', () => {
    expect(toPage([1])).toStrictEqual({ items: [1] })
    expect(toPage([1], 5)).toStrictEqual({ items: [1], next: '5' })
  })

  test('capPage keeps valid JSON under the cap, marks truncated, and resumes from the last kept item', () => {
    const items = Array.from({ length: 50 }, (_value, index) => ({ n: index, pad: 'x'.repeat(100) }))
    const out = capPage(toPage(items, 'orig'), { max: 1000, cursorOf: (index) => `c${index}` })
    const text = JSON.stringify(out)
    expect(text.length).toBeLessThanOrEqual(1000)
    expect(() => JSON.parse(text)).not.toThrow()
    expect(out.truncated).toBe(true)
    expect(out.items.length).toBeGreaterThan(0)
    expect(out.items.length).toBeLessThan(50)
    expect(out.next).toBe(`c${out.items.length - 1}`)
  })

  test('capPage without a cursor drops any stale next and hints at limit; small pages pass through', () => {
    const items = Array.from({ length: 50 }, () => ({ pad: 'x'.repeat(100) }))
    const out = capPage(toPage(items, 'would-skip-items'), { max: 1000 })
    expect(out.truncated).toBe(true)
    expect(out.next).toBeUndefined()
    expect(out.hint).toContain('limit')

    const small = toPage([{ a: 1 }])
    expect(capPage(small)).toBe(small)
  })
})

describe('covers PROJ-891 review fixes (unit)', () => {
  test('capPage backs off to a cut the tool allows (no splitting a shared timestamp)', () => {
    const ts = [1, 1, 2, 2, 2, 3, 3, 4]
    const items = ts.map((t) => ({ t, pad: 'x'.repeat(100) }))
    const out = capPage(toPage(items, 'orig'), {
      max: 600,
      cursorOf: (index) => globalThis.String(items[index].t),
      canCutAt: (kept) => items[kept - 1].t !== items[kept]?.t,
    })
    expect(out.truncated).toBe(true)
    const last = out.items[out.items.length - 1].t
    // Nothing sharing the cursor's second was left behind
    expect(items.slice(out.items.length).every((item) => item.t > last)).toBe(true)
    expect(out.next).toBe(globalThis.String(last))
  })

  test('capPage returns the whole page rather than skip items when no safe cut exists', () => {
    const items = Array.from({ length: 30 }, () => ({ t: 5, pad: 'x'.repeat(100) }))
    const page = toPage(items, 'orig')
    const out = capPage(page, {
      max: 1000,
      cursorOf: () => '5',
      canCutAt: (kept) => items[kept - 1].t !== items[kept]?.t,
    })
    expect(out).toBe(page)
  })

  test('capPage leaves an empty page alone', () => {
    const empty = toPage([])
    expect(capPage(empty)).toBe(empty)
  })

  test('full view keeps a custom status_key that differs from the legacy status', () => {
    const base = { title: 'T', status: 'in_progress', project_key: 'P', number: 1 }
    expect(shapeIssue({ ...base, status_key: 'qa' }, {}).status_key).toBe('qa')
    expect(shapeIssue({ ...base, status_key: 'in_progress' }, {})).not.toHaveProperty('status_key')
  })
})

interface ResponseShapingTestContext {
  fixture: Awaited<ReturnType<typeof seedProjectFixture>>
}

type ResponseShapingAuth = Pick<ResponseShapingTestContext['fixture'], 'token' | 'workspaceId'>

const IssueCursorPage = Schema.Struct({
  items: Schema.Array(JsonRecordResponse).pipe(Schema.mutable),
  next: Schema.optional(Schema.String),
})
const CursorPage = Schema.Struct({ ...ItemsResponse.fields, next: Schema.optional(Schema.String) })
const RequiredCursorPage = Schema.Struct({ ...ItemsResponse.fields, next: Schema.String })
const TruncatedPage = Schema.Struct({ ...ItemsResponse.fields, truncated: Schema.optional(Schema.Boolean) })
const WikiSectionResult = Schema.Struct({ contentTruncated: Schema.optional(Schema.Boolean) })

const tool = async function tool<S extends Schema.Constraint>(
  { token, workspaceId }: ResponseShapingAuth,
  params: McpToolRequest,
  shape: S,
): Promise<S['Type']> {
  const response = await fetchNativeMcpTool(workspaceId, params, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  })
  const body = await readNativeJson(response, McpRpcResponse)
  expect(body.result?.isError, JSON.stringify(body)).toBeUndefined()
  return parseNativeMcpText(body.result?.content?.[0].text ?? 'null', shape)
}

describe('covers PROJ-891: MCP tools', () => {
  const prevApiMax = env.RATE_LIMIT_API_MAX
  beforeAll(() => {
    env.RATE_LIMIT_API_MAX = '1000'
  })
  afterAll(() => {
    env.RATE_LIMIT_API_MAX = prevApiMax
  })

  beforeEach<ResponseShapingTestContext>(async (context) => {
    context.fixture = await seedProjectFixture()
  })

  test<ResponseShapingTestContext>('list_issues: summary view, {items,next} pagination, and cursor continuation', async ({
    fixture,
  }) => {
    await runIndexedInOrder(3, async (index): Promise<void> => {
      await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
        title: `Item ${index}`,
        createdAt: 1000 + index,
      })
    })
    const first = await tool(
      fixture,
      {
        arguments: {
          view: 'summary',
          limit: 2,
        },
        name: 'list_issues',
      },
      IssueCursorPage,
    )
    expect(first.items).toHaveLength(2)
    expect(first.next).toBeTypeOf('string')
    expect(first).not.toHaveProperty('nextCursor')
    expect(Object.keys(first.items[0]).toSorted()).toStrictEqual(
      ['priority', 'ref', 'status', 'title', 'updated'].toSorted(),
    )

    const second = await tool(
      fixture,
      {
        arguments: {
          view: 'summary',
          limit: 2,
          cursor: first.next,
        },
        name: 'list_issues',
      },
      IssueCursorPage,
    )
    expect(second.items).toHaveLength(1)
    expect(second.next).toBeUndefined()
    const refs = [...first.items, ...second.items].map((i) => i.ref)
    expect(new Set(refs).size).toBe(3)
  })

  test<ResponseShapingTestContext>('get_issue full view has ref, an array of labels and no internal ids', async ({
    fixture,
  }) => {
    const issue = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, { title: 'Shaped' })
    const got = await tool(fixture, { arguments: { id: issue.id }, name: 'get_issue' }, JsonRecordResponse)
    expect(got.ref).toMatch(/-\d+$/u)
    expect(got).not.toHaveProperty('workspace_id')
    expect(got).not.toHaveProperty('project_id')
    expect(got).not.toHaveProperty('created_by_id')
    // None set → dropped
    expect(got).not.toHaveProperty('labels')
  })

  test<ResponseShapingTestContext>('list_issues: a page over the cap is cut with truncated:true and resumes via next', async ({
    fixture,
  }) => {
    const pad = 'y'.repeat(400)
    await runIndexedInOrder(60, async (index): Promise<void> => {
      await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, {
        title: `${pad} ${index}`,
        createdAt: 2000 + index,
      })
    })
    const seen = new Set<string>()
    let cursor: string | undefined
    let truncatedPages = 0
    const issuePage = Schema.Struct({
      items: Schema.Array(Schema.Struct({ ref: Schema.String })),
      next: Schema.optional(Schema.String),
      truncated: Schema.optional(Schema.Boolean),
    })
    for (let guard = 0; guard < 10; guard += 1) {
      const args = {
        limit: 60,
        ...(Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor) ? { cursor } : {}),
      }
      const res = await fetchNativeMcpTool(
        fixture.workspaceId,
        { arguments: args, name: 'list_issues' },
        { Authorization: `Bearer ${fixture.token}`, 'Content-Type': 'application/json' },
      )
      const reply = await readNativeJson(res, RpcTextResponse)
      const text = readNativeMcpResultText(reply.result)
      expect(text.length).toBeLessThanOrEqual(20_000)
      const page = parseNativeMcpText(text, issuePage)
      if (page.truncated === true) {
        truncatedPages += 1
      }
      Iterable.forEach(page.items, (item) => {
        seen.add(item.ref)
      })
      if (!isNonEmptyText(page.next)) {
        break
      }
      cursor = page.next
    }
    expect(truncatedPages).toBeGreaterThan(0)
    // Nothing skipped, nothing repeated
    expect(seen.size).toBe(60)
  })

  test<ResponseShapingTestContext>('list_comments and list_project_activity return {items}', async ({ fixture }) => {
    const issue = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, { title: 'Talky' })
    await tool(fixture, { arguments: { issueId: issue.id, body: 'hi' }, name: 'add_comment' }, Schema.Unknown)
    const comments = await tool(
      fixture,
      {
        arguments: {
          issueId: issue.id,
        },
        name: 'list_comments',
      },
      MessageBodiesResponse,
    )
    expect(comments.items.map((item) => item.body)).toStrictEqual(['hi'])
    const activity = await tool(
      fixture,
      {
        arguments: {
          projectId: fixture.projectId,
        },
        name: 'list_project_activity',
      },
      ItemsResponse,
    )
    expect(Array.isArray(activity.items)).toBe(true)
  })

  test<ResponseShapingTestContext>('search_wiki and list_wiki_changes page with next/cursor', async ({ fixture }) => {
    await runInOrder(['Alpha Guide', 'Alpha Notes', 'Alpha Ideas'], async (t): Promise<void> => {
      await tool(
        fixture,
        { arguments: { title: t, content: 'alpha content' }, name: 'create_wiki_page' },
        Schema.Unknown,
      )
    })
    const p1 = await tool(fixture, { arguments: { query: 'alpha', limit: 2 }, name: 'search_wiki' }, CursorPage)
    expect(p1.items).toHaveLength(2)
    expect(p1.next).toBe('2')
    const p2 = await tool(
      fixture,
      { arguments: { query: 'alpha', limit: 2, cursor: p1.next }, name: 'search_wiki' },
      CursorPage,
    )
    expect(p2.items).toHaveLength(1)
    expect(p2.next).toBeUndefined()

    const changes = await tool(fixture, { arguments: { since: 0 }, name: 'list_wiki_changes' }, RequiredCursorPage)
    expect(changes.items.length).toBeGreaterThanOrEqual(3)
    const again = await tool(fixture, { arguments: { cursor: changes.next }, name: 'list_wiki_changes' }, CursorPage)
    expect(again.items).toStrictEqual([])
  })

  test<ResponseShapingTestContext>('wiki_tree returns {items}', async ({ fixture }) => {
    await tool(fixture, { arguments: { title: 'Root', content: 'x' }, name: 'create_wiki_page' }, Schema.Unknown)
    const tree = await tool(fixture, { arguments: {}, name: 'wiki_tree' }, ItemsResponse)
    expect(tree.items.length).toBeGreaterThan(0)
  })

  test<ResponseShapingTestContext>('list_comments is never cut: every comment is returned', async ({ fixture }) => {
    const issue = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId, { title: 'Chatty' })
    await runIndexedInOrder(30, async (index): Promise<void> => {
      await tool(
        fixture,
        { arguments: { issueId: issue.id, body: `${index} ${'c'.repeat(1000)}` }, name: 'add_comment' },
        Schema.Unknown,
      )
    })
    const res = await tool(
      fixture,
      {
        arguments: {
          issueId: issue.id,
        },
        name: 'list_comments',
      },
      TruncatedPage,
    )
    expect(res.items).toHaveLength(30)
    expect(res.truncated).toBeUndefined()
  })

  test<ResponseShapingTestContext>('list_wiki_changes: no changes means no `next`; an empty cursor does not replay from the epoch', async ({
    fixture,
  }) => {
    await tool(fixture, { arguments: { title: 'Some Page', content: 'x' }, name: 'create_wiki_page' }, Schema.Unknown)
    const future = currentEpochSeconds() + 3600
    const none = await tool(
      fixture,
      {
        arguments: {
          since: future,
        },
        name: 'list_wiki_changes',
      },
      CursorPage,
    )
    expect(none.items).toStrictEqual([])
    expect(none).not.toHaveProperty('next')

    const empty = await tool(
      fixture,
      {
        arguments: {
          since: future,
          cursor: '',
        },
        name: 'list_wiki_changes',
      },
      ItemsResponse,
    )
    expect(empty.items).toStrictEqual([])
  })

  test<ResponseShapingTestContext>('list_wiki_changes: `next` advances when the batch had changes, and a section read is flagged partial', async ({
    fixture,
  }) => {
    const result = await tool(
      fixture,
      {
        arguments: {
          title: 'Sect Page',
          content: '# A\nalpha\n## B\nbeta\n',
        },
        name: 'create_wiki_page',
      },
      SlugResponse,
    )
    const { slug } = result
    const changes = await tool(
      fixture,
      {
        arguments: {
          since: 0,
        },
        name: 'list_wiki_changes',
      },
      CursorPage,
    )
    expect(changes.items.length).toBeGreaterThan(0)
    expect(changes.next).toBeTypeOf('string')
    const sec = await tool(fixture, { arguments: { slug, section: 'B' }, name: 'get_wiki_page' }, WikiSectionResult)
    expect(sec.contentTruncated).toBe(true)
  })
})
