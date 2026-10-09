import type { Context, Next } from 'hono'

import { provisionPublicViewer } from '#commands/provisioning'
import {
  authenticateAccessJwt,
  authenticateDevelopment,
  type AuthUser,
  BrowserAuthenticationError,
  parseCookie,
  upsertUserByEmail,
} from '#services/authentication'
import type { HonoEnv } from '#types'

export { resetAuthCachesForTests, verifyJwtPayload } from '#services/authentication'
export type { AuthUser } from '#services/authentication'

import { unauthorizedChallenge } from '../auth/challenge'
import type { Capability } from '../auth/scopes'
import { capabilityForMethod, capabilityForOAuthScope, parseScopes, tokenAllows } from '../auth/scopes'
import { bumpRateCounter } from './rate-limit'
import { mcpWorkspaceIdFromPath } from './workspace'

// PROJ-373: the shared identity anonymous requests are provisioned as when
// PUBLIC_READ_ONLY is on. Fixed and well-known — there's exactly one, since
// anonymous callers share no session to distinguish them by.
const PUBLIC_VIEWER_EMAIL = 'public-viewer@projektor.local'

// PROJ-656: the shared viewer is one identity for every anonymous visitor on the
// internet, so it must never be treated as a person who can agree to something —
// notably, it cannot consent to an OAuth grant (routes/oauth.ts).
export function isPublicViewer(user: Readonly<{ email: string }>): boolean {
  return user.email === PUBLIC_VIEWER_EMAIL
}

/**
 * PROJ-903 / PROJ-917: credential minting and revocation happen only from an
 * interactive human session (Cloudflare Access JWT or the dev bypass). A bearer
 * token or OAuth grant is `authKind === "agent"` and is refused, as is the shared
 * PUBLIC_READ_ONLY viewer (human but anonymous). Returns a 403 response to send, or
 * null when the caller may proceed.
 */
export function requireInteractiveHuman(c: Context<HonoEnv>, message: string): Response | null {
  const user = c.get('user') as { email: string } | undefined
  if (c.get('authKind') !== 'human' || !user || isPublicViewer(user)) {
    return c.json({ error: message }, 403)
  }
  return null
}

// Matches the truthy-string convention used by WORKSPACE_SUBDOMAIN_ROUTING (PROJ-296).
function isTruthy(v: string | undefined): boolean {
  return ['true', '1', 'yes'].includes(v?.trim().toLowerCase() ?? '')
}

// PROJ-198: bound bearer-token guessing per source IP. The request rate-limiter keys
// authenticated traffic by token fingerprint, so a flood of *distinct* invalid tokens
// from one IP would otherwise each land in its own bucket and never throttle. Count
// failed bearer auths per IP and 429 once they exceed RATE_LIMIT_AUTH_FAIL_MAX. Tokens
// are 256-bit random, so this is defense-in-depth, not the primary control.
async function tooManyAuthFailures(c: Context<HonoEnv>): Promise<boolean> {
  const ip = c.req.header('CF-Connecting-IP') ?? '127.0.0.1'
  const windowSecs = parseInt(c.env.RATE_LIMIT_WINDOW_SECS ?? '60', 10)
  const limit = parseInt(c.env.RATE_LIMIT_AUTH_FAIL_MAX ?? '50', 10)
  // PROJ-867: a limiter outage must not turn a 401 into a 500 — fail open.
  try {
    const count = await bumpRateCounter(c.env, `authfail:${ip}`, windowSecs)
    return count > limit
  } catch (err) {
    console.error('auth-failure rate-limit counter unavailable, failing open', {
      err: String(err),
    })
    return false
  }
}

type AuthOutcome = { kind: 'skip' } | { kind: 'deny'; response: Response } | { kind: 'allow' }

// 0. OAuth 2.1 grant (PROJ-656/657). The provider has already verified the access
// token, checked its RFC 8707 audience against this exact URL, and decrypted the props
// recorded at consent onto the execution context — there is nothing left to
// authenticate here, only to translate into projektor's own request context.
//
// First in the chain, ahead of tryBearerTokenAuth: an OAuth access token is also a
// `Bearer`, and the API-token strategy would hash it, find no row, and deny before this
// ever ran.
type OAuthGrantProps = {
  userId: string
  email: string
  name: string
  workspaceId: string
  scopes: string[]
  // PROJ-889: recorded at consent for grants created after this change.
  clientId?: string
}

function oauthGrantProps(c: Context<HonoEnv>): OAuthGrantProps | null {
  const props = (c.executionCtx as { props?: unknown } | undefined)?.props as Partial<OAuthGrantProps> | undefined
  if (!props?.userId || !props.workspaceId || !Array.isArray(props.scopes)) return null
  return props as OAuthGrantProps
}

async function tryOAuthGrantAuth(c: Context<HonoEnv>): Promise<AuthOutcome> {
  const props = oauthGrantProps(c)
  if (!props) return { kind: 'skip' }

  const scopes = props.scopes.map(capabilityForOAuthScope).filter((cap): cap is Capability => cap !== null)

  const scopeError = checkTokenScope(c, scopes)
  if (scopeError) return { kind: 'deny', response: scopeError }

  c.set('user', { id: props.userId, email: props.email, name: props.name } satisfies AuthUser)
  // The audience check the provider already made confines the token to this
  // workspace's MCP path. Setting this makes workspaceMiddleware enforce the same
  // confinement independently, so a routing mistake that lands an OAuth request on
  // another workspace is a 403 rather than a cross-tenant read.
  c.set('tokenWorkspaceId', props.workspaceId)
  c.set('tokenScopes', scopes)
  // "agent", not "human", even though a person consented (PROJ-658). Two reasons, and
  // they point the same way. What lands on a comment or issue through this token was
  // written by a model, not typed by the person — the same thing a pk_ token from
  // Claude Code already records. And consentingUser() in routes/oauth.ts gates on
  // authKind === "human": calling this human would let an OAuth token approve further
  // grants, so a connector could quietly widen its own access.
  c.set('authKind', 'agent')
  c.set('auth', {
    kind: 'agent',
    method: 'oauth',
    credentialId: oauthGrantIdFromRequest(c),
    clientId: props.clientId,
    scopes,
  })
  return { kind: 'allow' }
}

// The provider's access token is `<userId>:<grantId>:<secret>` (see rate-limit.ts);
// the grant id is the stable credential identity across hourly token rotation.
function oauthGrantIdFromRequest(c: Context<HonoEnv>): string | undefined {
  const header = c.req.header('Authorization') ?? ''
  const parts = header.startsWith('Bearer ') ? header.slice(7).split(':') : []
  return parts.length === 3 && parts[1] ? parts[1] : undefined
}

// 1. Cloudflare Access JWT (header or cookie)
async function tryCfAccessAuth(c: Context<HonoEnv>): Promise<AuthOutcome> {
  const cfJwt = c.req.header('Cf-Access-Jwt-Assertion') ?? parseCookie(c.req.header('cookie') ?? '', 'CF_Authorization')
  if (!cfJwt) return { kind: 'skip' }

  try {
    const principal = await authenticateAccessJwt(cfJwt, c.env)
    c.set('user', principal.user)
    c.set('authKind', principal.auth.kind)
    c.set('auth', principal.auth)
    return { kind: 'allow' }
  } catch (err) {
    if (!(err instanceof BrowserAuthenticationError)) throw err
    return { kind: 'deny', response: c.json({ error: err.message }, err.status) }
  }
}

async function tooManyAuthFailuresResponse(c: Context<HonoEnv>, message: string): Promise<Response> {
  return (await tooManyAuthFailures(c)) ? c.json({ error: 'Too Many Requests' }, 429) : c.json({ error: message }, 401)
}

// PROJ-17: enforce the token's scope. REST is gated here by HTTP method
// (the single chokepoint where a token is authenticated). MCP is gated
// per-tool in routes/mcp.ts, since one POST /mcp can carry a read OR a
// write tool call, so method-based classification doesn't apply there.
function checkTokenScope(c: Context<HonoEnv>, scopes: ReturnType<typeof parseScopes>): Response | null {
  if (c.req.path.startsWith('/mcp/')) return null
  const required = capabilityForMethod(c.req.method)
  if (!tokenAllows(scopes, required)) {
    return c.json({ error: `Token lacks '${required}' scope` }, 403)
  }
  return null
}

// PROJ-360: last_used_at is a coarse "when was this token last seen" audit field,
// not something that needs per-request precision — only rewrite it once per
// this window to cut D1 write volume on the hottest auth path (bearer/agent
// traffic hits this on every request).
const LAST_USED_AT_THROTTLE_SECS = 60

async function authenticateApiToken(c: Context<HonoEnv>, token: string): Promise<AuthOutcome> {
  const hash = await hashToken(token)
  const row = await c.env.DB.prepare(
    `SELECT at.id, at.workspace_id, at.expires_at, at.scopes, at.last_used_at,
              u.id as user_id, u.email, u.name
       FROM api_tokens at
       LEFT JOIN users u ON u.id = at.user_id
       WHERE at.token_hash = ?`,
  )
    .bind(hash)
    .first<{
      id: string
      user_id: string
      email: string
      name: string
      workspace_id: string | null
      expires_at: number | null
      scopes: string | null
      last_used_at: number | null
    }>()

  if (!row) {
    return { kind: 'deny', response: await tooManyAuthFailuresResponse(c, 'Unauthorized') }
  }
  if (row.expires_at && row.expires_at < Date.now() / 1000) {
    return { kind: 'deny', response: await tooManyAuthFailuresResponse(c, 'Token expired') }
  }

  const scopes = parseScopes(row.scopes)
  const scopeError = checkTokenScope(c, scopes)
  if (scopeError) return { kind: 'deny', response: scopeError }

  c.set('user', { id: row.user_id, email: row.email, name: row.name } satisfies AuthUser)
  c.set('tokenWorkspaceId', row.workspace_id)
  c.set('tokenScopes', scopes)
  c.set('authKind', 'agent')
  c.set('auth', {
    kind: 'agent',
    method: token.startsWith('pk_') ? 'pk' : 'pat',
    credentialId: row.id,
    scopes,
  })

  const now = Math.floor(Date.now() / 1000)
  if (!row.last_used_at || now - row.last_used_at >= LAST_USED_AT_THROTTLE_SECS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?').bind(now, hash).run(),
    )
  }

  return { kind: 'allow' }
}

// 2. API token (Authorization: Bearer <token>)
async function tryBearerTokenAuth(c: Context<HonoEnv>): Promise<AuthOutcome> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return { kind: 'skip' }

  const token = authHeader.slice(7)
  return authenticateApiToken(c, token)
}

// 3. Local dev bypass
async function tryDevBypassAuth(c: Context<HonoEnv>): Promise<AuthOutcome> {
  if (c.env.ENVIRONMENT !== 'development' || !c.env.DEV_USER_EMAIL) return { kind: 'skip' }
  // PROJ-660: never on /mcp/. A remote MCP client learns it needs to authenticate by
  // getting a 401 with the RFC 9728 challenge on it; answering 200 instead tells the
  // client the server wants no credential at all, so the whole connector flow is
  // silently unreachable on any instance with the bypass on. That is precisely the
  // configuration an Access-free test instance has to run in.
  //
  // Nothing is lost: a `pk_` bearer token is strategy 2 and still authenticates MCP
  // here, and the bypass exists for browsing the UI without a login (README, e2e),
  // which is untouched.
  if (mcpWorkspaceIdFromPath(c.req.path)) return { kind: 'skip' }

  const principal = await authenticateDevelopment(c.env)
  if (!principal) return { kind: 'skip' }
  c.set('user', principal.user)
  c.set('authKind', principal.auth.kind)
  c.set('auth', principal.auth)
  return { kind: 'allow' }
}

// 4. Public read-only viewer (PROJ-373) — opt-in fallback, only when nothing else matched
async function tryPublicViewerAuth(c: Context<HonoEnv>): Promise<AuthOutcome> {
  if (!isTruthy(c.env.PUBLIC_READ_ONLY)) return { kind: 'skip' }

  const user = await upsertUserByEmail(PUBLIC_VIEWER_EMAIL, c.env.DB, c.env.KV)
  await provisionPublicViewer(c.env, user)
  c.set('user', user)
  c.set('authKind', 'human')
  c.set('auth', { kind: 'human', method: 'public' })
  return { kind: 'allow' }
}

// PROJ-651: attach the RFC 9728 challenge to MCP 401s. Applied once here rather than
// at each of the three deny sites (invalid CF Access JWT, failed bearer, nothing
// matched) so a future deny path cannot silently ship without it.
//
// Narrow by design: only status 401, and only on /mcp/<workspaceId>. /api/* 401s stay
// byte-identical — the frontend reloads the page to re-authenticate on a 401 and that
// is load-bearing (PROJ-430) — and the 429 from the failed-auth throttle and the 503
// from an unreachable JWKS endpoint are left alone, since neither is an invitation to
// authenticate.
function withMcpAuthChallenge(c: Context<HonoEnv>, response: Response): Response {
  if (response.status !== 401) return response
  const workspaceId = mcpWorkspaceIdFromPath(c.req.path)
  if (!workspaceId) return response
  response.headers.set('WWW-Authenticate', unauthorizedChallenge(c.req.url, workspaceId))
  return response
}

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  // tryPublicViewerAuth is last: a real CF Access session, bearer token, or dev
  // bypass always wins so a logged-in user is never demoted to the anonymous
  // viewer just because PUBLIC_READ_ONLY happens to be on too.
  for (const attempt of [
    tryOAuthGrantAuth,
    tryCfAccessAuth,
    tryBearerTokenAuth,
    tryDevBypassAuth,
    tryPublicViewerAuth,
  ]) {
    const outcome = await attempt(c)
    if (outcome.kind === 'deny') return withMcpAuthChallenge(c, outcome.response)
    if (outcome.kind === 'allow') return next()
  }

  return withMcpAuthChallenge(c, c.json({ error: 'Unauthorized' }, 401))
}

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
