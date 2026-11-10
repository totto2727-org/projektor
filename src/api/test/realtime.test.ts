import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { createIssue } from '#commands/issues'
import { broadcastWorkspaceEvent } from '#commands/realtime'
import type { ServiceCtx } from '#commands/types'
import type { ApiEnv, RealtimeEvent } from '#types'

import type { CoreActor } from '../../core/authorization'
import { CORE_ACTOR_HEADER } from '../../core/contract'
import { WorkspaceHub, type SocketAttachment } from '../realtime/workspace-hub'
import { authHeaders, hashToken, seedGroupGrant, seedProject, seedWorkspaceRoles } from './helpers'

function actorFor(token: string): CoreActor {
  return { requestUrl: 'http://localhost/api/realtime', method: 'GET', bearer: token }
}

// Socket doubles retain attachments across messages, like hibernating native sockets.
function socket(initial: SocketAttachment) {
  let attachment = initial
  const ws = {
    send: vi.fn<(message: string) => void>(),
    serializeAttachment: vi.fn((next: SocketAttachment) => {
      attachment = next
    }),
    deserializeAttachment: vi.fn(() => attachment),
    close: vi.fn(),
  }
  return ws
}

type Socket = ReturnType<typeof socket>

function hubFor(sockets: Socket[] = []) {
  const state = {
    acceptWebSocket: vi.fn<(ws: WebSocket) => void>(),
    getWebSockets: vi.fn(() => sockets),
  }
  const hub = new WorkspaceHub(state as unknown as DurableObjectState, env as unknown as ApiEnv)
  return { hub, state }
}

describe('Realtime WebSockets (Opt-In)', () => {
  let roles: Awaited<ReturnType<typeof seedWorkspaceRoles>>
  let projectId: string
  let otherProjectId: string

  beforeEach(async () => {
    roles = await seedWorkspaceRoles()
    projectId = (await seedProject(roles.workspace.id, 'SEEN')).id
    otherProjectId = (await seedProject(roles.workspace.id, 'OTHER')).id
    await seedGroupGrant(roles.workspace.id, roles.member.user.id, projectId, 'member')
    await seedGroupGrant(roles.workspace.id, roles.viewer.user.id, otherProjectId, 'viewer')
  })

  function attachmentFor(
    principal: 'owner' | 'member' | 'viewer' = 'member',
    overrides: Partial<SocketAttachment> = {},
  ): SocketAttachment {
    return {
      actor: actorFor(roles[principal].token),
      userId: roles[principal].user.id,
      workspaceId: roles.workspace.id,
      role: principal,
      visibleProjectIds: principal === 'viewer' ? [otherProjectId] : [projectId],
      subscribedAt: 1,
      snapshotAt: 1,
      ...overrides,
    }
  }

  function upgradeRequest(token: string) {
    return new Request('http://localhost/realtime', {
      headers: {
        Upgrade: 'websocket',
        [CORE_ACTOR_HEADER]: JSON.stringify(actorFor(token)),
        'X-Internal-Workspace-Id': roles.workspace.id,
      },
    })
  }

  function event(overrides: Partial<RealtimeEvent> = {}): RealtimeEvent {
    return {
      type: 'issue.created',
      workspaceId: roles.workspace.id,
      projectId,
      data: { id: 'issue-123' },
      timestamp: Math.floor(Date.now() / 1000),
      ...overrides,
    }
  }

  it('returns 501 when WORKSPACE_HUB is not configured (graceful degradation)', async () => {
    const response = await SELF.fetch(`http://localhost/api/workspaces/${roles.workspace.slug}/realtime`, {
      headers: { ...authHeaders(roles.owner.token, roles.workspace.slug), Upgrade: 'websocket' },
    })
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({
      error:
        'Realtime WebSockets are not enabled on this instance. Configure WORKSPACE_HUB in wrangler.toml to enable.',
    })
  })

  it('broadcastWorkspaceEvent is a silent no-op when WORKSPACE_HUB is undefined', async () => {
    const ctx: ServiceCtx = {
      db: env.DB,
      kv: env.KV,
      r2: env.R2,
      workspaceId: roles.workspace.id,
      userId: roles.owner.user.id,
    }
    await expect(
      broadcastWorkspaceEvent(ctx, { type: 'issue.created', projectId, data: { id: 'test-id' } }),
    ).resolves.toBeUndefined()
  })

  it('rejects WebSocket upgrades without a Core actor even when legacy identity headers claim owner', async () => {
    const { hub, state } = hubFor()
    const response = await hub.fetch(
      new Request('http://localhost/realtime', {
        headers: {
          Upgrade: 'websocket',
          'X-Internal-User-Id': roles.owner.user.id,
          'X-Internal-Workspace-Id': roles.workspace.id,
          'X-Internal-Role': 'owner',
        },
      }),
    )
    expect(response.status).toBe(401)
    expect(state.acceptWebSocket).not.toHaveBeenCalled()
  })

  it('requires a WebSocket upgrade before accepting a connection', async () => {
    const { hub, state } = hubFor()
    expect((await hub.fetch(new Request('http://localhost/realtime'))).status).toBe(426)
    expect(state.acceptWebSocket).not.toHaveBeenCalled()
  })

  it('computes member visibility from current Core grants rather than forged owner headers', async () => {
    const { hub, state } = hubFor()
    const request = upgradeRequest(roles.member.token)
    request.headers.set('X-Internal-User-Id', roles.owner.user.id)
    request.headers.set('X-Internal-Role', 'owner')
    const response = await hub.fetch(request)
    expect(response.status).toBe(101)
    expect(state.acceptWebSocket).toHaveBeenCalledTimes(1)
    const accepted = state.acceptWebSocket.mock.calls[0][0]
    expect(accepted.deserializeAttachment()).toMatchObject({
      actor: actorFor(roles.member.token),
      userId: roles.member.user.id,
      workspaceId: roles.workspace.id,
      role: 'member',
      visibleProjectIds: [projectId],
    })
  })

  it('computes all project IDs for an owner on upgrade', async () => {
    const { hub, state } = hubFor()
    expect((await hub.fetch(upgradeRequest(roles.owner.token))).status).toBe(101)
    const accepted = state.acceptWebSocket.mock.calls[0][0]
    expect(accepted.deserializeAttachment()).toMatchObject({
      role: 'owner',
      visibleProjectIds: expect.arrayContaining([projectId, otherProjectId]),
    })
    expect(accepted.deserializeAttachment()).toHaveProperty('visibleProjectIds.length', 2)
  })

  it('rejects a revoked credential before accepting a socket', async () => {
    await env.DB.prepare('DELETE FROM api_tokens WHERE token_hash = ?')
      .bind(await hashToken(roles.member.token))
      .run()
    const { hub, state } = hubFor()
    expect((await hub.fetch(upgradeRequest(roles.member.token))).status).toBe(401)
    expect(state.acceptWebSocket).not.toHaveBeenCalled()
  })

  it('responds to ping after refreshing a stale visibility snapshot', async () => {
    const ws = socket(attachmentFor('member', { visibleProjectIds: [] }))
    const { hub } = hubFor()
    await hub.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ action: 'ping' }))
    expect(ws.serializeAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'member', visibleProjectIds: [projectId] }),
    )
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"pong"'))
  })

  it('intersects subscriptions with current project grants', async () => {
    const ws = socket(attachmentFor())
    const { hub } = hubFor()
    await hub.webSocketMessage(
      ws as unknown as WebSocket,
      JSON.stringify({ action: 'subscribe', projects: [projectId, otherProjectId], eventTypes: ['issue.*'] }),
    )
    expect(ws.deserializeAttachment().filters).toEqual({ projects: [projectId], eventTypes: ['issue.*'] })
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"subscribed"'))
  })

  it('defaults a member subscription without a project filter to current visible projects', async () => {
    const ws = socket(attachmentFor())
    const { hub } = hubFor()
    await hub.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ action: 'subscribe' }))
    expect(ws.deserializeAttachment().filters).toEqual({ projects: [projectId], eventTypes: undefined })
  })

  it('broadcasts to matching subscriptions and filters other projects and event types', async () => {
    const matching = socket(attachmentFor('member', { filters: { projects: [projectId], eventTypes: ['issue.*'] } }))
    const otherProject = socket(
      attachmentFor('viewer', { filters: { projects: [otherProjectId], eventTypes: ['issue.*'] } }),
    )
    const otherType = socket(attachmentFor('member', { filters: { projects: [projectId], eventTypes: ['comment.*'] } }))
    const { hub } = hubFor([matching, otherProject, otherType])
    const broadcast = event()
    expect(await hub.broadcast(broadcast)).toEqual({ recipientCount: 1 })
    expect(matching.send).toHaveBeenCalledWith(JSON.stringify(broadcast))
    expect(otherProject.send).not.toHaveBeenCalled()
    expect(otherType.send).not.toHaveBeenCalled()
  })

  it('enforces current server-side visibility without a client filter', async () => {
    const allowed = socket(attachmentFor())
    const forbidden = socket(attachmentFor('viewer'))
    const admin = socket(attachmentFor('owner'))
    const { hub } = hubFor([allowed, forbidden, admin])
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 2 })
    expect(allowed.send).toHaveBeenCalledTimes(1)
    expect(forbidden.send).not.toHaveBeenCalled()
    expect(admin.send).toHaveBeenCalledTimes(1)
  })

  it('does not trust a cached project list or client filter over current grants', async () => {
    const ws = socket(attachmentFor('viewer', { visibleProjectIds: [projectId], filters: { projects: [projectId] } }))
    const { hub } = hubFor([ws])
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 0 })
    expect(ws.deserializeAttachment().visibleProjectIds).toEqual([otherProjectId])
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('fails closed for non-admins when an event has no projectId', async () => {
    const member = socket(attachmentFor())
    const admin = socket(attachmentFor('owner'))
    const { hub } = hubFor([member, admin])
    expect(await hub.broadcast(event({ type: 'workspace.announcement', projectId: undefined }))).toEqual({
      recipientCount: 1,
    })
    expect(member.send).not.toHaveBeenCalled()
    expect(admin.send).toHaveBeenCalledTimes(1)
  })

  it('denies a removed admin without sending a pong or a later workspace broadcast', async () => {
    const ws = socket(attachmentFor('owner'))
    const { hub } = hubFor([ws])
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 1 })
    ws.send.mockClear()
    await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(roles.workspace.id, roles.owner.user.id)
      .run()
    await hub.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ action: 'ping' }))
    expect(ws.send).not.toHaveBeenCalled()
    expect(await hub.broadcast(event({ type: 'workspace.event', projectId: undefined }))).toEqual({ recipientCount: 0 })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('drops a revoked grant on a passive socket immediately without a ping or stale-snapshot delay', async () => {
    const ws = socket(attachmentFor('member', { snapshotAt: Math.floor(Date.now() / 1000) }))
    const { hub } = hubFor([ws])
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 1 })
    ws.send.mockClear()
    await env.DB.prepare(
      'DELETE FROM group_project_grants WHERE project_id = ? AND group_id IN (SELECT group_id FROM user_group_members WHERE user_id = ?)',
    )
      .bind(projectId, roles.member.user.id)
      .run()
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 0 })
    expect(ws.deserializeAttachment().visibleProjectIds).toEqual([])
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('denies passive broadcasts immediately after token revocation', async () => {
    const ws = socket(attachmentFor('owner', { snapshotAt: Math.floor(Date.now() / 1000) }))
    const { hub } = hubFor([ws])
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 1 })
    ws.send.mockClear()
    await env.DB.prepare('DELETE FROM api_tokens WHERE token_hash = ?')
      .bind(await hashToken(roles.owner.token))
      .run()
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 0 })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('drops cached elevated access immediately after an owner is demoted', async () => {
    const ws = socket(attachmentFor('owner', { visibleProjectIds: [projectId, otherProjectId] }))
    const { hub } = hubFor([ws])
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 1 })
    ws.send.mockClear()
    await env.DB.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?')
      .bind('member', roles.workspace.id, roles.owner.user.id)
      .run()
    expect(await hub.broadcast(event())).toEqual({ recipientCount: 0 })
    expect(ws.deserializeAttachment()).toMatchObject({ role: 'member', visibleProjectIds: [] })
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('dispatches a broadcast event when creating an issue with a WORKSPACE_HUB stub', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ recipientCount: 1 })))
    const namespace = {
      idFromName: vi.fn().mockReturnValue('mock-do-id'),
      get: vi.fn().mockReturnValue({ fetch: fetchMock }),
    }
    const ctx: ServiceCtx = {
      db: env.DB,
      kv: env.KV,
      r2: env.R2,
      workspaceId: roles.workspace.id,
      userId: roles.owner.user.id,
      role: 'owner',
      workspaceHub: namespace as unknown as DurableObjectNamespace,
    }
    const created = await createIssue(ctx, { projectId, title: 'Realtime test issue' })
    expect(created.id).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://do/broadcast',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"type":"issue.created"') }),
    )
  })
})
