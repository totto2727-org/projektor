import type { Context } from 'hono'

import type { HonoEnv } from '#types'

import { CORE_ACTOR_HEADER } from '../../core/contract.ts'

/** Native binding fetch is reserved for streaming file endpoints. */
export function coreFileRequest(
  httpContext: Context<HonoEnv>,
  pathname: string,
  body?: BodyInit | null,
  contentType?: string,
): Promise<Response> {
  const workspace = httpContext.get('workspace')
  const url = new URL(pathname, 'https://core.internal')
  url.searchParams.set('workspaceId', workspace.id)
  const headers = new Headers({ [CORE_ACTOR_HEADER]: JSON.stringify(httpContext.get('coreActor')) })
  if (contentType !== undefined) {
    headers.set('Content-Type', contentType)
  }
  return httpContext.env.CORE.fetch(new Request(url, { method: httpContext.req.method, headers, body }))
}
