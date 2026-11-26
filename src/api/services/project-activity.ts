import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const listProjectActivity = async function listProjectActivity(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiListProjectActivity']>
): Promise<typeof ApiResults.apiListProjectActivity.Type> {
  return apiReply(
    ApiResults.apiListProjectActivity,
    ctx.core.apiListProjectActivity(ctx.actor, ctx.workspaceId, ...args),
  )
}
