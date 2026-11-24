import { OAuthProvider } from '@cloudflare/workers-oauth-provider'

// TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
import {
  AUTHORIZE_ENDPOINT,
  providerOptions,
  REGISTRATION_ENDPOINT,
  TOKEN_ENDPOINT,
} from '#contracts/oauth-provider.ts'
import type { ApiEnv } from '#types'

// TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
export { AUTHORIZE_ENDPOINT, oauthApi, REGISTRATION_ENDPOINT, TOKEN_ENDPOINT } from '#contracts/oauth-provider.ts'
import { bumpRateCounter } from '#api/middleware/rate-limit.ts'

/*
 * PROJ-656/657: the OAuth 2.1 token lifecycle, delegated to Cloudflare's provider.
 *
 * Why the library at all: it brings PKCE, single-use authorization codes, rotating
 * refresh tokens, RFC 7009 revocation, RFC 8707 resource indicators, CIMD client
 * registration, and RFC 8252 §7.3 loopback redirect matching — the last of which is
 * what makes Claude Code's ephemeral-port callback work. That is the half of OAuth
 * that is dangerous to hand-roll. See PROJ-654 for the evidence behind adopting it.
 *
 * Pinned exactly. The package is pre-1.0 and its surface has moved recently (CIMD,
 * resolveExternalToken and ExternalTokenError are all recent additions), so a float
 * on the minor is a float on our token security.
 */

/*
 * The library's own access tokens are `<userId>:<grantId>:<secret>`. worker.ts routes a
 * request to the provider only when the bearer has that shape, so every other
 * credential projektor accepts — `pk_` API tokens, the Cloudflare Access cookie, the
 * dev bypass, the PUBLIC_READ_ONLY viewer — never enters the provider and keeps
 * working exactly as before. Without that check, declaring /mcp/ an `apiRoute` would
 * 401 every request that arrives without a bearer, silently breaking anonymous
 * read-only instances (the live demo) and local dev.
 */
export function isOAuthAccessToken(request: Request): boolean {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return false
  }
  return header.slice(7).split(':').length === 3
}

/*
 * TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
 * The provider serves registration and token requests and injects its helpers
 * before passing authorization requests to Projektor's consent route.
 */
export function isOAuthProviderPath(pathname: string): boolean {
  // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
  return pathname === TOKEN_ENDPOINT || pathname === AUTHORIZE_ENDPOINT || pathname === REGISTRATION_ENDPOINT
}

/*
 * Revocation shares this URL: the provider handles issuance, refresh and RFC 7009
 * revocation on the one token endpoint, which is why the discovery document
 * advertises `revocation_endpoint` as the same path rather than a separate /oauth/revoke.
 */
export function createOAuthProvider(app: ExportedHandler<ApiEnv>) {
  return new OAuthProvider<ApiEnv>(providerOptions(app))
}

// TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
/** The provider serves these endpoints before Hono's rate limiter. */
export async function oauthProviderRateLimited(request: Request, env: ApiEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const isRegistration = pathname === REGISTRATION_ENDPOINT && request.method === 'POST'
  if (pathname !== TOKEN_ENDPOINT && !isRegistration) {
    return null
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? '127.0.0.1'
  const windowSecs = parseInt(env.RATE_LIMIT_WINDOW_SECS ?? '60', 10)
  const limit = parseInt(env.RATE_LIMIT_AUTH_MAX ?? '300', 10)
  // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
  const endpoint = isRegistration ? 'oauth-registration' : 'oauth-token'

  let count: number
  try {
    // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
    count = await bumpRateCounter(env, `${endpoint}:${ip}`, windowSecs)
  } catch (err) {
    // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
    console.error('OAuth rate-limit counter unavailable', { endpoint, err: String(err) })
    // A registration creates a new KV record for an anonymous caller.
    if (isRegistration) {
      return Response.json({ error: 'temporarily_unavailable' }, { status: 503 })
    }
    return null
  }
  if (count <= limit) {
    return null
  }

  return Response.json(
    // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
    {
      error: 'slow_down',
      error_description: isRegistration ? 'Too many registration requests' : 'Too many token requests',
    },
    { status: 429, headers: { 'Retry-After': String(windowSecs) } },
  )
}
