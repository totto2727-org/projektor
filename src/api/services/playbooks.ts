import { ApiResults } from '#contracts/api-results.ts'

import { apiReply } from './reply.ts'
import type { ApiServiceCtx } from './types.ts'

export const listPlaybooks = function listPlaybooks(
  ctx: Pick<ApiServiceCtx, 'core' | 'actor'>,
): Promise<typeof ApiResults.apiListPlaybooks.Type> {
  return apiReply(ApiResults.apiListPlaybooks, ctx.core.apiListPlaybooks(ctx.actor))
}

export const getPlaybook = function getPlaybook(
  ctx: Pick<ApiServiceCtx, 'core' | 'actor'>,
  name: string,
): Promise<typeof ApiResults.apiGetPlaybook.Type> {
  return apiReply(ApiResults.apiGetPlaybook, ctx.core.apiGetPlaybook(ctx.actor, name))
}
