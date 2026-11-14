import { ApiResults } from '../../contracts/api-results'
import { apiReply } from './reply'
import type { ApiServiceCtx } from './types'

export function getWorkflow(ctx: Pick<ApiServiceCtx, 'core' | 'actor'>, input: unknown = {}) {
  return apiReply(ApiResults.apiGetWorkflow, ctx.core.apiGetWorkflow(ctx.actor, input))
}
