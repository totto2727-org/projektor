import { ApiResults } from '#contracts/api-results.ts'
import type { CoreRpcShape } from '#core/contract.ts'

import { apiReply } from './reply.ts'
import type { ApiOperationArgs, ApiServiceCtx } from './types.ts'

export const composePlaybook = function composePlaybook(
  ctx: ApiServiceCtx,
  ...args: ApiOperationArgs<CoreRpcShape['apiComposePlaybook']>
): Promise<typeof ApiResults.apiComposePlaybook.Type> {
  return apiReply(ApiResults.apiComposePlaybook, ctx.core.apiComposePlaybook(ctx.actor, ctx.workspaceId, ...args))
}
