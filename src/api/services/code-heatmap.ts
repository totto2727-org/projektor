import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const getCodeHeatmap = async function getCodeHeatmap(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiGetCodeHeatmap']>
): Promise<typeof ApiResults.apiGetCodeHeatmap.Type> {
  return apiReply(ApiResults.apiGetCodeHeatmap, ctx.core.apiGetCodeHeatmap(ctx.actor, ctx.workspaceId, ...args))
}
