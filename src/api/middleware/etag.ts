import { String, Predicate } from 'effect'
import type { Context, Next } from 'hono'

import { HTTP_OK } from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

/*
 * PROJ-439: conditional GETs on the read-heavy JSON routes.
 *
 * The tag is a hash of the response body, computed after the handler has run. That
 * costs the D1/KV read either way — it saves the payload, the client's JSON.parse and
 * the island re-render, not server time. The alternative (deriving from updated_at or a
 * version counter, so the query could be skipped) was measured against the tree and
 * rejected on the ticket: getIssue/listProjects/listTaskStatuses already read through a
 * KV cache, so a version probe trades one read for another, and a `no-cache` ETag has no
 * TTL to bound a missed invalidation the way that cache's 60-300s does.
 *
 * Deliberately not `hono/etag`: it guards on neither method nor status, so a repeat
 * request carrying a matching If-None-Match gets a 304 in place of its 403.
 */

/*
 * `private` — these are per-user authorised responses behind Cloudflare Access, so no
 * shared cache may hold them. `no-cache` means "store, but revalidate every time",
 * which is the point; a max-age would risk showing one user a stale or foreign view.
 */
const CACHE_CONTROL = 'private, no-cache'

const ifNoneMatchMatches = function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
  if (Predicate.isNullish(header) || String.isEmpty(header)) {
    return false
  }
  if (header.trim() === '*') {
    return true
  }
  const stripWeak = (tag: string): string => tag.trim().replace(/^W\//u, '')
  return header.split(',').some((tag) => stripWeak(tag) === stripWeak(etag))
}

const sha256Prefix = async function sha256Prefix(input: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(buf).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const etagMiddleware = async function etagMiddleware(httpContext: Context<HonoEnv>, next: Next): Promise<void> {
  await next()

  /*
   * Registered after authMiddleware/workspaceMiddleware on the same prefixes, so an
   * unauthorised request never reaches here. This guard is the second lock: a 304 must
   * never stand in for a 401/403/404.
   */
  if (httpContext.req.method !== 'GET' || httpContext.res.status !== HTTP_OK) {
    return
  }

  const body = await httpContext.res.clone().arrayBuffer()
  const etag = `"${await sha256Prefix(body)}"`

  if (ifNoneMatchMatches(httpContext.req.header('If-None-Match'), etag)) {
    httpContext.res = new Response(undefined, {
      headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL },
      status: 304,
    })
    return
  }

  httpContext.res.headers.set('ETag', etag)
  httpContext.res.headers.set('Cache-Control', CACHE_CONTROL)
}
