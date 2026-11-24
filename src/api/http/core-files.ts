import { Predicate } from 'effect'
import type { Context } from 'hono'

import { CORE_ACTOR_HEADER } from '#core/contract.ts'
import type { HonoEnv } from '#types'

/** Native binding fetch is reserved for streaming file endpoints. */
export const coreFileRequest = function coreFileRequest(
  httpContext: Context<HonoEnv>,
  pathname: string,
  body?: BodyInit | null,
  contentType?: string,
): Promise<Response> {
  const workspace = httpContext.get('workspace')
  const url = new URL(pathname, 'https://core.internal')
  url.searchParams.set('workspaceId', workspace.id)
  const headers = new Headers({ [CORE_ACTOR_HEADER]: JSON.stringify(httpContext.get('coreActor')) })
  if (Predicate.isNotNullish(contentType)) {
    headers.set('Content-Type', contentType)
  }
  return httpContext.env.CORE.fetch(new Request(url, { method: httpContext.req.method, headers, body }))
}
