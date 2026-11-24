import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listCustomFieldDefs = function listCustomFieldDefs(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListCustomFieldDefs']>
): Promise<typeof ApiResults.apiListCustomFieldDefs.Type> {
  return apiReply(
    ApiResults.apiListCustomFieldDefs,
    ctx.core.apiListCustomFieldDefs(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const createCustomFieldDef = function createCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateCustomFieldDef']>
): Promise<typeof ApiResults.apiCreateCustomFieldDef.Type> {
  return apiReply(
    ApiResults.apiCreateCustomFieldDef,
    ctx.core.apiCreateCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const updateCustomFieldDef = function updateCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateCustomFieldDef']>
): Promise<typeof ApiResults.apiUpdateCustomFieldDef.Type> {
  return apiReply(
    ApiResults.apiUpdateCustomFieldDef,
    ctx.core.apiUpdateCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
export const deleteCustomFieldDef = function deleteCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteCustomFieldDef']>
): Promise<typeof ApiResults.apiDeleteCustomFieldDef.Type> {
  return apiReply(
    ApiResults.apiDeleteCustomFieldDef,
    ctx.core.apiDeleteCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
