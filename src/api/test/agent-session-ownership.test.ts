import { describe, expect, test } from 'vite-plus/test'
import { z } from 'zod'

import { env } from './fixture-api.ts'
import { authHeaders, seedIssueFixture, seedToken, toolError } from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

const ownershipFixture = async function ownershipFixture(role: 'owner' | 'admin') {
  const testFixture = await seedIssueFixture({ role })
  const foreignToken = await seedToken(testFixture.workspaceId, testFixture.userId)
  const send = (path: string, body: unknown, token = testFixture.token, method = 'POST'): Promise<Response> =>
    fetchNativeApi(
      `http://localhost${path}`,
      requestOptionsWithBody(method, authHeaders(token, testFixture.slug), JSON.stringify(body)),
    )
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

const actAs = function actAs(fixture: OwnershipFixture, action: ActAs): Promise<Response> {
  const token = fixture.foreignToken
  switch (action) {
    case 'heartbeat': {
      return fixture.send(`/api/agents/${fixture.sessionId}/heartbeat`, { allowAdministrativeOverride: true }, token)
    }
    case 'message': {
      return fixture.send(
        '/api/agent-messages',
        { scope: 'workspace', agentId: fixture.sessionId, body: 'Spoofed' },
        token,
      )
    }
    case 'issue claim': {
      return fixture.send(`/api/issues/${fixture.issueId}/claim`, { agentId: fixture.sessionId }, token)
    }
    case 'file claim': {
      return fixture.send(
        '/api/file-claims',
        { issueId: fixture.issueId, agentId: fixture.sessionId, paths: ['src/foreign.ts'], force: true },
        token,
      )
    }
    case 'issue attribution': {
      return fixture.send(
        `/api/issues/${fixture.issueId}`,
        { title: 'Spoofed', agentSessionId: fixture.sessionId },
        token,
        'PATCH',
      )
    }
    case 'finish work': {
      return fixture.send('/api/agents/finish-work', { sessionId: fixture.sessionId, issue: fixture.issueId }, token)
    }
  }
}

const coordinationState = async function coordinationState(fixture: OwnershipFixture) {
  return {
    session: await env.DB.prepare('SELECT * FROM agent_sessions WHERE id = ?').bind(fixture.sessionId).first(),
    lease: await env.DB.prepare('SELECT * FROM issue_leases WHERE issue_id = ?').bind(fixture.issueId).first(),
    claims: await env.DB.prepare('SELECT * FROM issue_file_claims WHERE issue_id = ? ORDER BY path')
      .bind(fixture.issueId)
      .all()
      .then((result) => result.results),
    messages: await env.DB.prepare('SELECT * FROM agent_messages WHERE workspace_id = ? ORDER BY id')
      .bind(fixture.workspaceId)
      .all()
      .then((result) => result.results),
    issue: await env.DB.prepare('SELECT title, status FROM issues WHERE id = ?').bind(fixture.issueId).first(),
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
      await expect(coordinationState(testFixture)).resolves.toStrictEqual(before)
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
    await expect(coordinationState(testFixture)).resolves.toStrictEqual(before)
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
          const result = await coordinationState(testFixture)
          expect(result.lease).toMatchObject({ released_at: expect.any(Number) })
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
          const result = await coordinationState(testFixture)
          expect(result.claims).toStrictEqual([
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
          expect(state.claims).toStrictEqual([
            expect.objectContaining({ path: 'src/held.ts', released_at: expect.any(Number) }),
          ])
          break
        }
      }
    },
  )
})
