import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function listPlaybooks(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiListPlaybooks']>) {
  return apiReply(ApiResults.apiListPlaybooks, ctx.core.apiListPlaybooks(ctx.actor, ctx.workspaceId, ...args))
}

export function getPlaybook(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiGetPlaybook']>) {
  return apiReply(ApiResults.apiGetPlaybook, ctx.core.apiGetPlaybook(ctx.actor, ctx.workspaceId, ...args))
}
