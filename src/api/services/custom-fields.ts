import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listCustomFieldDefs = function listCustomFieldDefs(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListCustomFieldDefs']>
) {
  return apiReply(
    ApiResults.apiListCustomFieldDefs,
    ctx.core.apiListCustomFieldDefs(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const createCustomFieldDef = function createCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateCustomFieldDef']>
) {
  return apiReply(
    ApiResults.apiCreateCustomFieldDef,
    ctx.core.apiCreateCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const updateCustomFieldDef = function updateCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateCustomFieldDef']>
) {
  return apiReply(
    ApiResults.apiUpdateCustomFieldDef,
    ctx.core.apiUpdateCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const deleteCustomFieldDef = function deleteCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteCustomFieldDef']>
) {
  return apiReply(
    ApiResults.apiDeleteCustomFieldDef,
    ctx.core.apiDeleteCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
