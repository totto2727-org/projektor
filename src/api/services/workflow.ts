import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function getWorkflow(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetWorkflow']>) {
  return apiReply(ApiResults.apiGetWorkflow, ctx.core.apiGetWorkflow(ctx.actor, ctx.workspaceId, ...args))
}
