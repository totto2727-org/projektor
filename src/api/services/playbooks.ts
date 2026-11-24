import { ApiResults } from '#contracts/api-results.ts'

import { apiReply } from './reply.ts'
import type { ApiServiceCtx } from './types.ts'

export const listPlaybooks = function listPlaybooks(ctx: Pick<ApiServiceCtx, 'core' | 'actor'>) {
  return apiReply(ApiResults.apiListPlaybooks, ctx.core.apiListPlaybooks(ctx.actor))
}

export const getPlaybook = function getPlaybook(ctx: Pick<ApiServiceCtx, 'core' | 'actor'>, name: string) {
  return apiReply(ApiResults.apiGetPlaybook, ctx.core.apiGetPlaybook(ctx.actor, name))
}
