import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listProjectActivity(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListProjectActivity']>
) {
  return apiReply(
    ApiResults.apiListProjectActivity,
    ctx.core.apiListProjectActivity(ctx.actor, ctx.workspaceId, ...args),
  )
}
