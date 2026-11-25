import { Result, Schema, pipe } from 'effect'
import type { Context } from 'hono'
import { makeCoreClient } from 'projektor/core-client'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { CoreActor } from '#core/authorization.ts'
import type { CoreRpcShape } from '#core/contract.ts'
import type { AuthInfo, HonoEnv, Role } from '#types'

/** Adapter context contains identity hints for presentation, never storage or domain authority. */
export type ApiServiceCtx = Readonly<{
  core: CoreRpcShape
  actor: CoreActor
  workspaceId: string
  userId: string
  role?: Role
  authKind?: 'human' | 'agent'
  auth?: AuthInfo
}>

const RoleSchema = Schema.UndefinedOr(Schema.Literals(['owner', 'admin', 'member', 'viewer']))
const decodeRole = Schema.decodeUnknownResult(RoleSchema)

export const ctxFromHono = function ctxFromHono(httpContext: Context<HonoEnv>): ApiServiceCtx {
  return fieldsInOrder([
    ['core', makeCoreClient(httpContext.env.CORE)],
    ['actor', httpContext.get('coreActor')],
    ['workspaceId', httpContext.get('workspace').id],
    ['userId', httpContext.get('user').id],
    ['role', pipe(httpContext.get('role'), decodeRole, Result.getOrThrow)],
    ['authKind', httpContext.get('authKind')],
    ['auth', httpContext.get('auth')],
  ])
}

/** Keep arguments tied to the named native operation without importing its implementation. */
export type ApiOperationArgs<T> = T extends (actor: CoreActor, workspaceId: string, ...args: infer Args) => unknown
  ? Args
  : never
