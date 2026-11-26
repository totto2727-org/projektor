import { String, Array, Predicate } from 'effect'
import { makeCoreClient } from 'projektor/core-client'

import { apiReply } from '#api/services/reply.ts'
import { ApiRealtimeSnapshot } from '#contracts/api-public.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import type { CoreActor } from '#core/authorization.ts'
import { CORE_ACTOR_HEADER } from '#core/contract.ts'
import type { ApiEnv, RealtimeEvent, Role } from '#types'

const NORMAL_CLOSURE_CODE = 1000
const LAST_REGISTERED_CLOSE_CODE = 1014
const RESERVED_CLOSE_CODE = 1004
const NO_STATUS_CLOSE_CODE = 1005
const ABNORMAL_CLOSURE_CODE = 1006
const FIRST_APPLICATION_CLOSE_CODE = 3000
const LAST_APPLICATION_CLOSE_CODE = 4999
const INTERNAL_ERROR_CLOSE_CODE = 1011
const TOPIC_PREFIX_START = 0
const WILDCARD_SUFFIX_START = -2

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

const isWorkspaceAdmin = function isWorkspaceAdmin(role: Role | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

export class WorkspaceHub {
  public ctx: DurableObjectState
  public env: ApiEnv

  public constructor(ctx: DurableObjectState, env: ApiEnv) {
    this.ctx = ctx
    this.env = env
  }

  public async fetch(request: Request): Promise<Response> {
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
          headers: { 'Content-Type': 'application/json' },
          status: 400,
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
      if (
        Predicate.isNullish(serialized) ||
        String.isEmpty(serialized) ||
        Predicate.isNullish(workspaceId) ||
        String.isEmpty(workspaceId)
      ) {
        return new Response('Unauthorized', { status: 401 })
      }
      actor = JSON.parse(serialized) as CoreActor
      snapshot = await this.loadSnapshot(actor, workspaceId)
    } catch {
      return new Response('Unauthorized', { status: 401 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.ctx.acceptWebSocket(server)

    const now = currentEpochSeconds()
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
      snapshotAt: currentEpochSeconds(),
    }
  }

  public async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!Predicate.isString(message)) {
      return
    }

    try {
      const data = JSON.parse(message) as {
        action?: string
        projects?: unknown[]
        eventTypes?: unknown[]
      }

      let attachment = ws.deserializeAttachment() as SocketAttachment | null
      if (!attachment) {
        return
      }

      attachment = await this.refreshSnapshot(attachment)
      ws.serializeAttachment(attachment)

      if (data.action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: currentEpochSeconds() }))
        return
      }

      if (data.action === 'subscribe') {
        const allowedProjects = new Set(attachment.visibleProjectIds)
        const requestedProjects = globalThis.Array.isArray(data.projects)
          ? data.projects.filter((id): id is string => Predicate.isString(id))
          : undefined

        let effectiveProjects: string[] | undefined
        if (requestedProjects) {
          // Intersect the client-supplied list with the server-side visible set.
          effectiveProjects = requestedProjects.filter((id) => allowedProjects.has(id))
        } else if (!isWorkspaceAdmin(attachment.role)) {
          /*
           * Non-admin with no explicit filter defaults to their visible set,
           * never "every project in the workspace".
           */
          effectiveProjects = attachment.visibleProjectIds
        }

        const filters: SubscriptionFilters = {
          projects: effectiveProjects,
          eventTypes: globalThis.Array.isArray(data.eventTypes)
            ? data.eventTypes.filter((eventType): eventType is string => Predicate.isString(eventType))
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
            timestamp: currentEpochSeconds(),
          }),
        )
      }
    } catch {
      // Ignore malformed client JSON
    }
  }

  public async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const registered =
      code >= NORMAL_CLOSURE_CODE &&
      code <= LAST_REGISTERED_CLOSE_CODE &&
      ![RESERVED_CLOSE_CODE, NO_STATUS_CLOSE_CODE, ABNORMAL_CLOSURE_CODE].includes(code)
    const application = code >= FIRST_APPLICATION_CLOSE_CODE && code <= LAST_APPLICATION_CLOSE_CODE
    const replyCode = Number.isInteger(code) && (registered || application) ? code : NORMAL_CLOSURE_CODE
    ws.close(replyCode, 'Closed')
  }

  public async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close(INTERNAL_ERROR_CLOSE_CODE, 'Internal error')
  }

  public async broadcast(event: RealtimeEvent): Promise<{ recipientCount: number }> {
    const sockets = this.ctx.getWebSockets()
    let recipientCount = 0
    const payload = JSON.stringify(event)

    for (const ws of sockets) {
      try {
        let attachment = ws.deserializeAttachment() as SocketAttachment | null
        if (!attachment || attachment.workspaceId !== event.workspaceId) {
          continue
        }
        attachment = await this.refreshSnapshot(attachment)
        ws.serializeAttachment(attachment)

        /*
         * Server-side project visibility check: non-admins must receive only
         * events scoped to a project they can see. Missing projectId is treated
         * as "deny" for non-admins (fail-closed).
         */
        if (!isWorkspaceAdmin(attachment.role)) {
          if (!isNonEmptyText(event.projectId)) {
            continue
          }
          const visible = new Set(attachment.visibleProjectIds)
          if (!visible.has(event.projectId)) {
            continue
          }
        }

        const { filters } = attachment

        /*
         * Apply the client-requested project filter (already intersected with
         * visibility at subscribe time, but re-checking is cheap and robust).
         */
        if (
          filters?.projects &&
          Array.isArrayNonEmpty(filters.projects) &&
          isNonEmptyText(event.projectId) &&
          !filters.projects.includes(event.projectId)
        ) {
          continue
        }

        if (filters?.eventTypes && Array.isArrayNonEmpty(filters.eventTypes)) {
          const matched = filters.eventTypes.some((pattern) => {
            if (pattern.endsWith('.*')) {
              const prefix = pattern.slice(TOPIC_PREFIX_START, WILDCARD_SUFFIX_START)
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
