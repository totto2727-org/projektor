import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listProjectActivity = function listProjectActivity(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListProjectActivity']>
) {
  return apiReply(
    ApiResults.apiListProjectActivity,
    ctx.core.apiListProjectActivity(ctx.actor, ctx.workspaceId, ...args),
  )
}
