import { ApiResults } from '../../contracts/api-results'
import type { CoreRpcShape } from '../../core/contract'
import { apiReply } from './reply'
import type { ApiOperationArgs, ApiServiceCtx } from './types'

export function composePlaybook(ctx: ApiServiceCtx, ...args: ApiOperationArgs<CoreRpcShape['apiComposePlaybook']>) {
  return apiReply(ApiResults.apiComposePlaybook, ctx.core.apiComposePlaybook(ctx.actor, ctx.workspaceId, ...args))
}
