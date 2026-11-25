import { Predicate } from 'effect'
import type { Context } from 'hono'

import { CORE_ACTOR_HEADER } from '#core/contract.ts'
import type { HonoEnv } from '#types'

/**
 * Send a streaming file request through the native Core binding.
 *
 * @param {Context<HonoEnv>} httpContext API request context with the method, workspace and authentication proof.
 * @param {string} pathname Internal Core file route.
 * @param {BodyInit | null} [body] Optional request body to forward.
 * @param {string} [contentType] Optional Content-Type header for the forwarded body.
 * @returns {Promise<Response>} The response from Core.
 */
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
