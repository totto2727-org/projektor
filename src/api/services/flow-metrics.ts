import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function getFlowMetrics(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetFlowMetrics']>) {
  return apiReply(ApiResults.apiGetFlowMetrics, ctx.core.apiGetFlowMetrics(ctx.actor, ctx.workspaceId, ...args))
}
