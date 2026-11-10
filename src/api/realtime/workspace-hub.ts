import { makeCoreClient } from 'projektor/core-client'

import type { ApiEnv, RealtimeEvent, Role } from '#types'

import { ApiRealtimeSnapshot } from '../../contracts/api-public'
import type { CoreActor } from '../../core/authorization'
import { CORE_ACTOR_HEADER } from '../../core/contract'
import { apiReply } from '../services/reply'

export interface SubscriptionFilters {
  projects?: string[]
  eventTypes?: string[]
}

export interface SocketAttachment {
  actor: CoreActor
  userId: string
  workspaceId: string
  role?: Role
  visibleProjectIds: string[]
  subscribedAt: number
  snapshotAt: number
  filters?: SubscriptionFilters
}

const INTERNAL_WORKSPACE_ID_HEADER = 'X-Internal-Workspace-Id'

function isWorkspaceAdmin(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export class WorkspaceHub {
  ctx: DurableObjectState
  env: ApiEnv

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    this.ctx = ctx
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      try {
        const event = (await request.json()) as RealtimeEvent
        const result = await this.broadcast(event)
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid broadcast payload' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 })
    }

    let snapshot: typeof ApiRealtimeSnapshot.Type
    let actor: CoreActor
    try {
      const serialized = request.headers.get(CORE_ACTOR_HEADER)
      const workspaceId = request.headers.get(INTERNAL_WORKSPACE_ID_HEADER)
      if (!serialized || !workspaceId) return new Response('Unauthorized', { status: 401 })
      actor = JSON.parse(serialized) as CoreActor
      snapshot = await this.loadSnapshot(actor, workspaceId)
    } catch {
      return new Response('Unauthorized', { status: 401 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.ctx.acceptWebSocket(server)

    const now = Math.floor(Date.now() / 1000)
    const initialAttachment: SocketAttachment = {
      actor,
      userId: snapshot.userId,
      workspaceId: snapshot.workspaceId,
      role: snapshot.role,
      visibleProjectIds: [...snapshot.visibleProjectIds],
      subscribedAt: now,
      snapshotAt: now,
    }
    server.serializeAttachment(initialAttachment)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  private loadSnapshot(actor: CoreActor, workspaceId: string) {
    return apiReply(ApiRealtimeSnapshot, makeCoreClient(this.env.CORE).apiRealtimeSnapshot(actor, workspaceId))
  }

  private async refreshSnapshot(attachment: SocketAttachment): Promise<SocketAttachment> {
    const snapshot = await this.loadSnapshot(attachment.actor, attachment.workspaceId)
    return {
      ...attachment,
      role: snapshot.role,
      visibleProjectIds: [...snapshot.visibleProjectIds],
      snapshotAt: Math.floor(Date.now() / 1000),
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return

    try {
      const data = JSON.parse(message) as {
        action?: string
        projects?: unknown[]
        eventTypes?: unknown[]
      }

      let attachment = ws.deserializeAttachment() as SocketAttachment | null
      if (!attachment) return

      attachment = await this.refreshSnapshot(attachment)
      ws.serializeAttachment(attachment)

      if (data.action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Math.floor(Date.now() / 1000) }))
        return
      }

      if (data.action === 'subscribe') {
        const allowedProjects = new Set(attachment.visibleProjectIds)
        const requestedProjects = Array.isArray(data.projects)
          ? data.projects.filter((id): id is string => typeof id === 'string')
          : undefined

        let effectiveProjects: string[] | undefined
        if (requestedProjects) {
          // Intersect the client-supplied list with the server-side visible set.
          effectiveProjects = requestedProjects.filter((id) => allowedProjects.has(id))
        } else if (!isWorkspaceAdmin(attachment.role)) {
          // Non-admin with no explicit filter defaults to their visible set,
          // never "every project in the workspace".
          effectiveProjects = attachment.visibleProjectIds
        }

        const filters: SubscriptionFilters = {
          projects: effectiveProjects,
          eventTypes: Array.isArray(data.eventTypes)
            ? data.eventTypes.filter((t): t is string => typeof t === 'string')
            : undefined,
        }

        ws.serializeAttachment({
          ...attachment,
          filters,
        })

        ws.send(
          JSON.stringify({
            type: 'subscribed',
            filters,
            timestamp: Math.floor(Date.now() / 1000),
          }),
        )
      }
    } catch {
      // Ignore malformed client JSON
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    ws.close(code, 'Closed')
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close(1011, 'Internal error')
  }

  async broadcast(event: RealtimeEvent): Promise<{ recipientCount: number }> {
    const sockets = this.ctx.getWebSockets()
    let recipientCount = 0
    const payload = JSON.stringify(event)

    for (const ws of sockets) {
      try {
        let attachment = ws.deserializeAttachment() as SocketAttachment | null
        if (!attachment || attachment.workspaceId !== event.workspaceId) continue
        attachment = await this.refreshSnapshot(attachment)
        ws.serializeAttachment(attachment)

        // Server-side project visibility check: non-admins must receive only
        // events scoped to a project they can see. Missing projectId is treated
        // as "deny" for non-admins (fail-closed).
        if (!isWorkspaceAdmin(attachment.role)) {
          if (!event.projectId) continue
          const visible = new Set(attachment.visibleProjectIds)
          if (!visible.has(event.projectId)) {
            continue
          }
        }

        const filters = attachment.filters

        // Apply the client-requested project filter (already intersected with
        // visibility at subscribe time, but re-checking is cheap and robust).
        if (filters?.projects && filters.projects.length > 0 && event.projectId) {
          if (!filters.projects.includes(event.projectId)) {
            continue
          }
        }

        if (filters?.eventTypes && filters.eventTypes.length > 0) {
          const matched = filters.eventTypes.some((pattern) => {
            if (pattern.endsWith('.*')) {
              const prefix = pattern.slice(0, -2)
              return event.type.startsWith(`${prefix}.`) || event.type === prefix
            }
            return pattern === event.type
          })
          if (!matched) {
            continue
          }
        }

        ws.send(payload)
        recipientCount++
      } catch {
        // Socket closed or failed to send
      }
    }

    return { recipientCount }
  }
}
