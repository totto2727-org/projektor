import { describe, expect, test } from 'vite-plus/test'
import { z } from 'zod'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssueFixture, seedToken, toolError } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'

const ownershipFixture = async function ownershipFixture(role: 'owner' | 'admin') {
  const testFixture = await seedIssueFixture({ role })
  const foreignToken = await seedToken(testFixture.workspaceId, testFixture.userId)
  const send = (path: string, body: unknown, token = testFixture.token, method = 'POST'): Promise<Response> =>
    fetchNativeApi(`http://localhost${path}`, {
      method,
      headers: authHeaders(token, testFixture.slug),
      body: JSON.stringify(body),
    })
  const registered = await send('/api/agents', { name: 'holder', issueId: testFixture.issueId })
  expect(registered.status).toBe(201)
  const session = z.object({ id: z.string() }).parse(await registered.json())
  const result = await send(`/api/issues/${testFixture.issueId}/claim`, { agentId: session.id })
  expect(result.status).toBe(201)
  const resolvedValue = await send('/api/file-claims', {
    issueId: testFixture.issueId,
    agentId: session.id,
    paths: ['src/held.ts'],
  })
  expect(resolvedValue.status).toBe(201)
  return { ...testFixture, foreignToken, sessionId: session.id, send }
}

type OwnershipFixture = Awaited<ReturnType<typeof ownershipFixture>>
type ActAs = 'heartbeat' | 'message' | 'issue claim' | 'file claim' | 'issue attribution' | 'finish work'

const actAs = function actAs(f: OwnershipFixture, action: ActAs): Promise<Response> {
  const token = f.foreignToken
  switch (action) {
    case 'heartbeat':
      return f.send(`/api/agents/${f.sessionId}/heartbeat`, { allowAdministrativeOverride: true }, token)
    case 'message':
      return f.send('/api/agent-messages', { scope: 'workspace', agentId: f.sessionId, body: 'Spoofed' }, token)
    case 'issue claim':
      return f.send(`/api/issues/${f.issueId}/claim`, { agentId: f.sessionId }, token)
    case 'file claim':
      return f.send(
        '/api/file-claims',
        { issueId: f.issueId, agentId: f.sessionId, paths: ['src/foreign.ts'], force: true },
        token,
      )
    case 'issue attribution':
      return f.send(`/api/issues/${f.issueId}`, { title: 'Spoofed', agentSessionId: f.sessionId }, token, 'PATCH')
    case 'finish work':
      return f.send('/api/agents/finish-work', { sessionId: f.sessionId, issue: f.issueId }, token)
  }
}

const coordinationState = async function coordinationState(f: OwnershipFixture) {
  return {
    session: await env.DB.prepare('SELECT * FROM agent_sessions WHERE id = ?').bind(f.sessionId).first(),
    lease: await env.DB.prepare('SELECT * FROM issue_leases WHERE issue_id = ?').bind(f.issueId).first(),
    claims: await env.DB.prepare('SELECT * FROM issue_file_claims WHERE issue_id = ? ORDER BY path')
      .bind(f.issueId)
      .all()
      .then((result) => result.results),
    messages: await env.DB.prepare('SELECT * FROM agent_messages WHERE workspace_id = ? ORDER BY id')
      .bind(f.workspaceId)
      .all()
      .then((result) => result.results),
    issue: await env.DB.prepare('SELECT title, status FROM issues WHERE id = ?').bind(f.issueId).first(),
  }
}

describe.each(['owner', 'admin'] as const)('native Core session ownership for workspace %s', (role) => {
  test.each<ActAs>(['heartbeat', 'message', 'issue claim', 'file claim', 'issue attribution', 'finish work'])(
    'rejects foreign-credential %s without coordination side effects',
    async (action) => {
      const testFixture = await ownershipFixture(role)
      const before = await coordinationState(testFixture)
      const response = await actAs(testFixture, action)
      expect(response.status).toBe(403)
      await expect(coordinationState(testFixture)).resolves.toEqual(before)
    },
  )

  test('does not admit a caller-supplied override through MCP', async () => {
    const testFixture = await ownershipFixture(role)
    const before = await coordinationState(testFixture)
    const response = await testFixture.send(
      `/mcp/${testFixture.slug}`,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'heartbeat_agent',
          arguments: { agentId: testFixture.sessionId, allowAdministrativeOverride: true },
        },
      },
      testFixture.foreignToken,
    )
    expect(response.status).toBe(200)
    expect(toolError(await response.json())).toMatchObject({ code: 'forbidden' })
    await expect(coordinationState(testFixture)).resolves.toEqual(before)
  })

  test.each(['lease', 'files', 'session'] as const)(
    'allows foreign-credential administrative %s cleanup',
    async (target) => {
      const testFixture = await ownershipFixture(role)
      switch (target) {
        case 'lease': {
          const response = await testFixture.send(
            `/api/issues/${testFixture.issueId}/release`,
            {},
            testFixture.foreignToken,
          )
          expect(response.status).toBe(200)
          expect((await coordinationState(testFixture)).lease).toMatchObject({ released_at: expect.any(Number) })
          break
        }
        case 'files': {
          const response = await testFixture.send(
            '/api/file-claims/release',
            { paths: ['src/held.ts'] },
            testFixture.foreignToken,
          )
          expect(response.status).toBe(200)
          await expect(response.json()).resolves.toMatchObject({ count: 1 })
          expect((await coordinationState(testFixture)).claims).toEqual([
            expect.objectContaining({ path: 'src/held.ts', released_at: expect.any(Number) }),
          ])
          break
        }
        case 'session': {
          const response = await testFixture.send(
            `/api/agents/${testFixture.sessionId}/end`,
            {},
            testFixture.foreignToken,
          )
          expect(response.status).toBe(200)
          await expect(response.json()).resolves.toMatchObject({ id: testFixture.sessionId, status: 'ended' })
          const state = await coordinationState(testFixture)
          expect(state.session).toMatchObject({ ended_at: expect.any(Number), status: 'ended' })
          expect(state.lease).toMatchObject({ released_at: expect.any(Number) })
          expect(state.claims).toEqual([
            expect.objectContaining({ path: 'src/held.ts', released_at: expect.any(Number) }),
          ])
          break
        }
      }
    },
  )
})
