import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function getCodeHeatmap(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetCodeHeatmap']>) {
  return apiReply(ApiResults.apiGetCodeHeatmap, ctx.core.apiGetCodeHeatmap(ctx.actor, ctx.workspaceId, ...args))
}
