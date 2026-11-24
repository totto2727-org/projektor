import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export function getFlowMetrics(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetFlowMetrics']>) {
  return apiReply(ApiResults.apiGetFlowMetrics, ctx.core.apiGetFlowMetrics(ctx.actor, ctx.workspaceId, ...args))
}
