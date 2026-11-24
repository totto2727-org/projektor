import { ApiResults } from '#contracts/api-results.ts'

import { apiReply } from './reply.ts'
import type { ApiServiceCtx } from './types.ts'

export const getWorkflow = function getWorkflow(ctx: Pick<ApiServiceCtx, 'core' | 'actor'>, input: unknown = {}) {
  return apiReply(ApiResults.apiGetWorkflow, ctx.core.apiGetWorkflow(ctx.actor, input))
}
