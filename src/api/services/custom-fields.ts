import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listCustomFieldDefs(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListCustomFieldDefs']>
) {
  return apiReply(
    ApiResults.apiListCustomFieldDefs,
    ctx.core.apiListCustomFieldDefs(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function createCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiCreateCustomFieldDef']>
) {
  return apiReply(
    ApiResults.apiCreateCustomFieldDef,
    ctx.core.apiCreateCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function updateCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiUpdateCustomFieldDef']>
) {
  return apiReply(
    ApiResults.apiUpdateCustomFieldDef,
    ctx.core.apiUpdateCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
export function deleteCustomFieldDef(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiDeleteCustomFieldDef']>
) {
  return apiReply(
    ApiResults.apiDeleteCustomFieldDef,
    ctx.core.apiDeleteCustomFieldDef(ctx.actor, ctx.workspaceId, ...args),
  )
}
