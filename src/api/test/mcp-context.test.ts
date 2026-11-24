import { Schema } from 'effect'
import { Hono } from 'hono'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { authMiddleware } from '#api/middleware/auth.ts'
/*
 * PROJ-889: MCP calls get the full ServiceCtx (realtime hub, waitUntil) and every auth
 * strategy records its method + credential on the request context.
 */
import { currentEpochSeconds } from '#contracts/time.ts'
import type { AuthInfo, HonoEnv } from '#types'

import { env, getCoreObservations, resetCoreObservations } from './fixture-api.ts'
import { hashToken, seedFixture, seedIssueFixture, seedUserToken } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { readNativeJson } from './response-json.ts'

describe('covers PROJ-889: MCP mutations broadcast like REST', () => {
  test('add_comment over MCP posts a realtime event to the workspace hub', async () => {
    const testFixture = await seedIssueFixture()
    await resetCoreObservations()

    const res = await fetchNativeApi(`http://localhost/mcp/${testFixture.workspaceId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${testFixture.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'add_comment', arguments: { issueId: testFixture.issueId, body: 'hi' } },
      }),
    })
    expect(res.status).toBe(200)
    const rpcShape = Schema.Struct({
      error: Schema.optional(Schema.Unknown),
      result: Schema.optional(Schema.Struct({ isError: Schema.optional(Schema.Boolean) })),
    })
    const rpc = await readNativeJson(res, rpcShape)
    expect(rpc.error).toBeUndefined()
    expect(rpc.result).toBeDefined()
    expect(rpc.result?.isError).not.toBe(true)

    await expect.poll(async () => (await getCoreObservations()).broadcasts.length).toBeGreaterThan(0)
    const { broadcasts } = await getCoreObservations()
    expect(broadcasts.length).toBeGreaterThan(0)
    expect(broadcasts[0].url).toMatch(/\/broadcast$/u)
    expect(JSON.parse(broadcasts[0].body)).toMatchObject({
      workspaceId: testFixture.workspaceId,
      projectId: testFixture.projectId,
      type: 'comment.created',
      data: { issueId: testFixture.issueId },
    })
  })
})

describe('covers PROJ-889: auth middleware records method + credential', () => {
  const app = new Hono<HonoEnv>()
  app.use('*', authMiddleware)
  app.get('/whoami', (httpContext) => httpContext.json(httpContext.get('auth')))

  const whoami = async function whoami(headers: Record<string, string> = {}): Promise<AuthInfo> {
    const res = await app.request('/whoami', { headers }, env, {
      waitUntil: () => {},
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext)
    expect(res.status).toBe(200)
    return (await res.json()) as AuthInfo
  }

  const prevDev = env.DEV_USER_EMAIL
  afterEach(() => {
    env.DEV_USER_EMAIL = prevDev
  })

  test('a pk_ workspace token → method pk, with its api_tokens id and scopes', async () => {
    const { workspace, user } = await seedFixture()
    const raw = `pk_${crypto.randomUUID().replace(/-/gu, '')}`
    const id = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO api_tokens (id, workspace_id, user_id, name, token_hash, scopes, created_at)
			 VALUES (?, ?, ?, 'pk', ?, '["read"]', ?)`,
    )
      .bind(id, workspace.id, user.id, await hashToken(raw), currentEpochSeconds())
      .run()

    const auth = await whoami({ Authorization: `Bearer ${raw}` })
    expect(auth).toMatchObject({ credentialId: id, kind: 'agent', method: 'pk' })
    expect(auth.scopes).toContain('read')
  })

  test('a personal access token → method pat', async () => {
    const { user } = await seedFixture()
    const pat = await seedUserToken(user.id)
    const auth = await whoami({ Authorization: `Bearer ${pat}` })
    expect(auth.kind).toBe('agent')
    expect(auth.method).toBe('pat')
    expect(typeof auth.credentialId).toBe('string')
  })

  test('the dev bypass → method dev', async () => {
    const { user } = await seedFixture()
    env.DEV_USER_EMAIL = user.email
    await expect(whoami()).resolves.toEqual({ kind: 'human', method: 'dev' })
  })
})
