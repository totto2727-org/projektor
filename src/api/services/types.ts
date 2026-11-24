import { Schema } from 'effect'
import type { Context } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import type { CoreActor } from '#core/authorization.ts'
import type { CoreRpcShape } from '#core/contract.ts'
import type { AuthInfo, HonoEnv, Role } from '#types'

/** Adapter context contains identity hints for presentation, never storage or domain authority. */
export interface ApiServiceCtx {
  readonly core: CoreRpcShape
  readonly actor: CoreActor
  readonly workspaceId: string
  readonly userId: string
  readonly role?: Role
  readonly authKind?: 'human' | 'agent'
  readonly auth?: AuthInfo
}

const RoleSchema = Schema.UndefinedOr(Schema.Literals(['owner', 'admin', 'member', 'viewer']))

export const ctxFromHono = function ctxFromHono(httpContext: Context<HonoEnv>): ApiServiceCtx {
  return {
    core: makeCoreClient(httpContext.env.CORE),
    actor: httpContext.get('coreActor'),
    workspaceId: httpContext.get('workspace').id,
    userId: httpContext.get('user').id,
    role: Schema.decodeUnknownSync(RoleSchema)(httpContext.get('role')),
    authKind: httpContext.get('authKind'),
    auth: httpContext.get('auth'),
  }
}

/** Keep arguments tied to the named native operation without importing its implementation. */
export type ApiOperationArgs<T> = T extends (actor: CoreActor, workspaceId: string, ...args: infer Args) => unknown
  ? Args
  : never
