import { Schema } from 'effect'
import type { Context } from 'hono'

import type { AuthInfo, HonoEnv, Role } from '#types'

import type { CoreActor } from '../../core/authorization'
import { makeCoreClient } from '../../core/client'
import type { CoreRpcShape } from '../../core/contract'

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

export function ctxFromHono(c: Context<HonoEnv>): ApiServiceCtx {
  return {
    core: makeCoreClient(c.env.CORE),
    actor: c.get('coreActor'),
    workspaceId: c.get('workspace').id,
    userId: c.get('user').id,
    role: Schema.decodeUnknownSync(RoleSchema)(c.get('role')),
    authKind: c.get('authKind'),
    auth: c.get('auth'),
  }
}

export type ServiceCtx = ApiServiceCtx

/** Keep arguments tied to the named native operation without importing its implementation. */
export type ApiOperationArgs<T> = T extends (actor: CoreActor, workspaceId: string, ...args: infer Args) => unknown
  ? Args
  : never
