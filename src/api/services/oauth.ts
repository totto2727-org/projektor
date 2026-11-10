import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listConnectorGrants(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListConnectorGrants']>
) {
  return apiReply(
    ApiResults.apiListConnectorGrants,
    ctx.core.apiListConnectorGrants(ctx.actor, ctx.workspaceId, ...args),
  )
}

export function revokeConnectorGrant(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRevokeConnectorGrant']>
) {
  return apiReply(
    ApiResults.apiRevokeConnectorGrant,
    ctx.core.apiRevokeConnectorGrant(ctx.actor, ctx.workspaceId, ...args),
  )
}
