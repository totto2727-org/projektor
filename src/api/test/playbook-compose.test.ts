import { Schema, Iterable } from 'effect'
import { assert, describe, expect, test } from 'vite-plus/test'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssue, seedIssueFixture, seedProject, toolError } from './helpers.ts'
import { fetchNativeApi, fetchNativeMcpTool, requestOptionsWithBody } from './native-fetch.ts'
import { RpcTextResponse, parseNativeMcpText, readNativeJson, readNativeMcpResultText } from './response-json.ts'

type PlaybookFixture = Awaited<ReturnType<typeof seedIssueFixture>> & Readonly<{ epicNumber: number }>
type PlaybookAuth = Pick<PlaybookFixture, 'slug' | 'token' | 'workspaceId'>

const seedPlaybookFixture = async function seedPlaybookFixture(): Promise<PlaybookFixture> {
  const fixture = await seedIssueFixture({ issueTitle: 'Ship the widget' })
  /*
   * Read the seeded number directly from D1 rather than via the API — hitting
   * GET /api/issues/:id here would warm getIssue's cache before children are
   * seeded below, and compose_playbook's own getIssue call would then read a
   * stale (childless) rollup for the rest of the test.
   */
  const row = await env.DB.prepare('SELECT number FROM issues WHERE id = ?')
    .bind(fixture.issueId)
    .first<{ number: number }>()
  assert.exists(row)
  return { ...fixture, epicNumber: row.number }
}

const compose = async function compose(
  { slug, token, workspaceId }: PlaybookAuth,
  params: Record<string, unknown>,
  name = 'epic-goal',
): Promise<Response> {
  return fetchNativeMcpTool(
    workspaceId,
    { arguments: { name, params }, name: 'compose_playbook' },
    authHeaders(token, slug),
  )
}

describe('compose_playbook', () => {
  test('composes with defaults (bounded, opus, cadence 2), well-formed blockquote, and embeds live data', async () => {
    expect.hasAssertions()
    const testFixture = await seedPlaybookFixture()
    const { issueId: epicId, epicNumber, projectId, userId, workspaceId } = testFixture
    await seedIssue(workspaceId, projectId, userId, { parentId: epicId, title: 'Child 1' })
    await seedIssue(workspaceId, projectId, userId, {
      parentId: epicId,
      status: 'done',
      title: 'Child 2 (done)',
    })
    /*
     * Non-default WIP limit so the assertion below can't pass on the fallback
     * default (DEFAULT_AGENT_WIP_LIMIT is also 3) — prove the value actually
     * flows from the project row, not from fetchAgentWipCap's no-match default.
     */
    await env.DB.prepare('UPDATE projects SET agent_wip_limit = ? WHERE id = ?').bind(7, projectId).run()

    const res = await compose(testFixture, { epicRef: `PROJ-${epicNumber}` })
    const json = await readNativeJson(res, RpcTextResponse)
    const text = readNativeMcpResultText(json.result)
    const body = parseNativeMcpText(
      text,
      Schema.Struct({ directive: Schema.String, name: Schema.String, variant: Schema.String }),
    )

    expect({ name: body.name, variant: body.variant }).toStrictEqual({ name: 'epic-goal', variant: 'bounded' })
    const contextFragments = ['Ship the widget', `PROJ-${epicNumber}`, 'Self-feed (bounded)']
    expect(contextFragments.filter((fragment) => !body.directive.includes(fragment))).toStrictEqual([])
    expect(body.directive).not.toContain('Self-feed (full)')
    const directiveFragments = [
      'every 2 completed tickets',
      'adversarial opus review',
      'Human checkpoint',
      'every 10 completed tickets',
      'Least confident about',
      'cheap to reverse now and expensive later',
      // One open child (Child 1), one done (Child 2) -> rollup.remaining == 1
      '1 open child ticket(s)',
      'WIP limit is 7',
    ]
    expect(directiveFragments.filter((fragment) => !body.directive.includes(fragment))).toStrictEqual([])
    /*
     * Every quoted line starts with "> " and there's no run-on "clause>clause"
     * artifact from a malformed line-join
     */
    Iterable.forEach(body.directive.split('\n'), (line) => {
      expect(line === '>' || line.startsWith('> ')).toBe(true)
    })
    expect(body.directive).not.toMatch(/[^\n]>\s*$/mu)
  })

  test('composes the full variant with a custom review model and cadence', async () => {
    const testFixture = await seedPlaybookFixture()
    const { epicNumber } = testFixture
    const res = await compose(testFixture, {
      epicRef: `PROJ-${epicNumber}`,
      variant: 'full',
      reviewModel: 'sonnet',
      cadence: 5,
    })
    const json = await readNativeJson(res, RpcTextResponse)
    const text = readNativeMcpResultText(json.result)
    const body = parseNativeMcpText(text, Schema.Struct({ directive: Schema.String, variant: Schema.String }))

    expect(body.variant).toBe('full')
    expect(body.directive).toContain('Self-feed (full)')
    expect(body.directive).not.toContain('Self-feed (bounded)')
    const reviewFragments = ['every 5 completed tickets', 'adversarial sonnet review']
    expect(reviewFragments.filter((fragment) => !body.directive.includes(fragment))).toStrictEqual([])
  })

  test('honors a custom checkpointInterval', async () => {
    const testFixture = await seedPlaybookFixture()
    const { epicNumber } = testFixture
    const res = await compose(testFixture, { epicRef: `PROJ-${epicNumber}`, checkpointInterval: 3 })
    const json = await readNativeJson(res, RpcTextResponse)
    const text = readNativeMcpResultText(json.result)
    const body = parseNativeMcpText(text, Schema.Struct({ directive: Schema.String }))

    expect(body.directive).toContain('every 3 completed tickets')
  })

  test('notes when the epic has no open child tickets yet', async () => {
    const testFixture = await seedPlaybookFixture()
    const { epicNumber } = testFixture
    const res = await compose(testFixture, { epicRef: `PROJ-${epicNumber}` })
    const json = await readNativeJson(res, RpcTextResponse)
    const text = readNativeMcpResultText(json.result)
    const body = parseNativeMcpText(text, Schema.Struct({ directive: Schema.String }))

    expect(body.directive).toContain('no open child tickets yet')
  })

  test("errors like an unresolvable ref when epicRef points at a project the caller can't see", async () => {
    const testFixture = await seedPlaybookFixture()
    const { userId, workspaceId } = testFixture
    /*
     * A second project in the same workspace that the fixture's member token
     * was never granted access to (seedIssueFixture only grants the first
     * project) — assertIssueProjectVisible must reject this before any
     * title/rollup data is returned.
     */
    const otherProject = await seedProject(workspaceId, 'SECRET')
    const otherEpic = await seedIssue(workspaceId, otherProject.id, userId, {
      title: 'Confidential epic',
    })

    const res = await compose(testFixture, { epicRef: `SECRET-${otherEpic.number}` })
    const err = toolError(await res.json())
    expect(err?.code).toBe('not_found')
    expect(err?.message).toContain('not found')
    expect(err?.message).not.toContain('Confidential epic')
  })

  test('errors on an unresolvable epicRef', async () => {
    const testFixture = await seedPlaybookFixture()
    const res = await compose(testFixture, { epicRef: 'PROJ-999999' })
    const err = toolError(await res.json())
    expect(err?.code).toBe('not_found')
    expect(err?.message).toContain('not found')
  })

  test('errors on a missing epicRef', async () => {
    const testFixture = await seedPlaybookFixture()
    const res = await compose(testFixture, {})
    expect(toolError(await res.json())?.code).toBe('validation')
  })

  test('errors on an invalid cadence', async () => {
    const testFixture = await seedPlaybookFixture()
    const { epicNumber } = testFixture
    const res = await compose(testFixture, { epicRef: `PROJ-${epicNumber}`, cadence: -1 })
    expect(toolError(await res.json())?.code).toBe('validation')
  })

  test('errors on an invalid checkpointInterval', async () => {
    const testFixture = await seedPlaybookFixture()
    const { epicNumber } = testFixture
    const res = await compose(testFixture, { epicRef: `PROJ-${epicNumber}`, checkpointInterval: -1 })
    expect(toolError(await res.json())?.code).toBe('validation')
  })

  test('errors on an unknown playbook name, naming valid options', async () => {
    const testFixture = await seedPlaybookFixture()
    const { epicNumber } = testFixture
    const res = await compose(testFixture, { epicRef: `PROJ-${epicNumber}` }, 'does-not-exist')
    const err = toolError(await res.json())
    expect(err?.code).toBe('not_found')
    expect(err?.message).toContain('does-not-exist')
    expect(err?.details?.validNames).toContain('epic-goal')
  })
})

// PROJ-633: REST parity for compose_playbook
describe('handles POST /api/playbooks/:name/compose', () => {
  test('returns 200 for epic-goal with a valid params body', async () => {
    const { epicNumber, slug, token } = await seedPlaybookFixture()
    const res = await fetchNativeApi(
      'http://localhost/api/playbooks/epic-goal/compose',
      requestOptionsWithBody(
        'POST',
        { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
        JSON.stringify({ epicRef: `PROJ-${epicNumber}` }),
      ),
    )
    expect(res.status).toBe(200)
    const body = await readNativeJson(
      res,
      Schema.Struct({ directive: Schema.String, name: Schema.String, variant: Schema.String }),
    )
    expect(body.name).toBe('epic-goal')
    expect(body.directive).toContain('Ship the widget')
  })

  test("returns a 4xx via the service's validation for a bad body", async () => {
    const { slug, token } = await seedPlaybookFixture()
    const res = await fetchNativeApi(
      'http://localhost/api/playbooks/epic-goal/compose',
      requestOptionsWithBody(
        'POST',
        { ...authHeaders(token, slug), 'Content-Type': 'application/json' },
        JSON.stringify({}),
      ),
    )
    /*
     * Specifically 400, not a 4xx range: an unregistered route would 404 and satisfy
     * a range assertion, so the loose form cannot tell "validation rejected this"
     * from "this endpoint does not exist".
     */
    expect(res.status).toBe(400)
  })
})
