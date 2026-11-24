import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listConnectorGrants = function listConnectorGrants(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListConnectorGrants']>
): Promise<typeof ApiResults.apiListConnectorGrants.Type> {
  return apiReply(
    ApiResults.apiListConnectorGrants,
    ctx.core.apiListConnectorGrants(ctx.actor, ctx.workspaceId, ...args),
  )
}

export const revokeConnectorGrant = function revokeConnectorGrant(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiRevokeConnectorGrant']>
): Promise<typeof ApiResults.apiRevokeConnectorGrant.Type> {
  return apiReply(
    ApiResults.apiRevokeConnectorGrant,
    ctx.core.apiRevokeConnectorGrant(ctx.actor, ctx.workspaceId, ...args),
  )
}
