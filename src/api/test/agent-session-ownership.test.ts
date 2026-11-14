import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vite-plus/test'
import { z } from 'zod'

import { env } from './fixture-api'
import { authHeaders, seedIssueFixture, seedToken, toolError } from './helpers'

async function ownershipFixture(role: 'owner' | 'admin') {
  const f = await seedIssueFixture({ role })
  const foreignToken = await seedToken(f.workspaceId, f.userId)
  const send = (path: string, body: unknown, token = f.token, method = 'POST') =>
    SELF.fetch(`http://localhost${path}`, {
      method,
      headers: authHeaders(token, f.slug),
      body: JSON.stringify(body),
    })
  const registered = await send('/api/agents', { name: 'holder', issueId: f.issueId })
  expect(registered.status).toBe(201)
  const session = z.object({ id: z.string() }).parse(await registered.json())
  expect((await send(`/api/issues/${f.issueId}/claim`, { agentId: session.id })).status).toBe(201)
  expect(
    (await send('/api/file-claims', { issueId: f.issueId, agentId: session.id, paths: ['src/held.ts'] })).status,
  ).toBe(201)
  return { ...f, foreignToken, sessionId: session.id, send }
}

type OwnershipFixture = Awaited<ReturnType<typeof ownershipFixture>>
type ActAs = 'heartbeat' | 'message' | 'issue claim' | 'file claim' | 'issue attribution' | 'finish work'

function actAs(f: OwnershipFixture, action: ActAs) {
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

async function coordinationState(f: OwnershipFixture) {
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
  it.each<ActAs>(['heartbeat', 'message', 'issue claim', 'file claim', 'issue attribution', 'finish work'])(
    'rejects foreign-credential %s without coordination side effects',
    async (action) => {
      const f = await ownershipFixture(role)
      const before = await coordinationState(f)
      const response = await actAs(f, action)
      expect(response.status).toBe(403)
      expect(await coordinationState(f)).toEqual(before)
    },
  )

  it('does not admit a caller-supplied override through MCP', async () => {
    const f = await ownershipFixture(role)
    const before = await coordinationState(f)
    const response = await f.send(
      `/mcp/${f.slug}`,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'heartbeat_agent',
          arguments: { agentId: f.sessionId, allowAdministrativeOverride: true },
        },
      },
      f.foreignToken,
    )
    expect(response.status).toBe(200)
    expect(toolError(await response.json())).toMatchObject({ code: 'forbidden' })
    expect(await coordinationState(f)).toEqual(before)
  })

  it.each(['lease', 'files', 'session'] as const)(
    'allows foreign-credential administrative %s cleanup',
    async (target) => {
      const f = await ownershipFixture(role)
      switch (target) {
        case 'lease': {
          const response = await f.send(`/api/issues/${f.issueId}/release`, {}, f.foreignToken)
          expect(response.status).toBe(200)
          expect((await coordinationState(f)).lease).toMatchObject({ released_at: expect.any(Number) })
          break
        }
        case 'files': {
          const response = await f.send('/api/file-claims/release', { paths: ['src/held.ts'] }, f.foreignToken)
          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({ count: 1 })
          expect((await coordinationState(f)).claims).toEqual([
            expect.objectContaining({ path: 'src/held.ts', released_at: expect.any(Number) }),
          ])
          break
        }
        case 'session': {
          const response = await f.send(`/api/agents/${f.sessionId}/end`, {}, f.foreignToken)
          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({ id: f.sessionId, status: 'ended' })
          const state = await coordinationState(f)
          expect(state.session).toMatchObject({ status: 'ended', ended_at: expect.any(Number) })
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
