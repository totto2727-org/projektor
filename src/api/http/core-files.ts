import type { Context } from 'hono'

import type { HonoEnv } from '#types'

import { CORE_ACTOR_HEADER } from '../../core/contract'

/** Native binding fetch is reserved for streaming file endpoints. */
export function coreFileRequest(
  c: Context<HonoEnv>,
  pathname: string,
  body?: BodyInit | null,
  contentType?: string,
): Promise<Response> {
  const workspace = c.get('workspace')
  const url = new URL(pathname, 'https://core.internal')
  url.searchParams.set('workspaceId', workspace.id)
  const headers = new Headers({ [CORE_ACTOR_HEADER]: JSON.stringify(c.get('coreActor')) })
  if (contentType !== undefined) headers.set('Content-Type', contentType)
  return c.env.CORE.fetch(new Request(url, { method: c.req.method, headers, body }))
}
