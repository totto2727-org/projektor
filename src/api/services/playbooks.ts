import { ApiResults } from '../../contracts/api-results'
import { apiReply } from './reply'
import type { ApiServiceCtx } from './types'

export function listPlaybooks(ctx: Pick<ApiServiceCtx, 'core' | 'actor'>) {
  return apiReply(ApiResults.apiListPlaybooks, ctx.core.apiListPlaybooks(ctx.actor))
}

export function getPlaybook(ctx: Pick<ApiServiceCtx, 'core' | 'actor'>, name: string) {
  return apiReply(ApiResults.apiGetPlaybook, ctx.core.apiGetPlaybook(ctx.actor, name))
}
