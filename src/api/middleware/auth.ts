import { Effect, Schema } from 'effect'
import type { Context, Next } from 'hono'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import { ApiPrincipal, type ApiUser, VerifiedApiOauthGrant } from '../../contracts/api-auth'
import { capabilityForMethod, tokenAllows } from '../../contracts/auth-scopes'
import type { CoreActor } from '../../core/authorization'
import { CorePublicError } from '../../core/contract'
import { unauthorizedChallenge } from '../auth/challenge'
import { bumpRateCounter } from './rate-limit'
import { mcpWorkspaceIdFromPath } from './workspace'

export type AuthUser = typeof ApiUser.Type

export function isPublicViewer(user: Readonly<{ email: string }>): boolean {
  return user.email === 'public-viewer@projektor.local'
}

export function requireInteractiveHuman(c: Context<HonoEnv>, message: string): Response | null {
  const auth = c.get('auth')
  if (auth?.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
    return c.json({ error: message }, 403)
  }
  return null
}

function accessCookie(cookie: string): string | undefined {
  return cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('CF_Authorization='))
    ?.slice(17)
}

/** Only provider-created execution props, never public request headers, become OAuth proof. */
function requestActor(c: Context<HonoEnv>): CoreActor {
  const authorization = c.req.header('Authorization')
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
  const accessJwt = c.req.header('Cf-Access-Jwt-Assertion') ?? accessCookie(c.req.header('cookie') ?? '')
  const props: unknown = c.executionCtx.props
  const verified = Schema.decodeUnknownOption(VerifiedApiOauthGrant)(props)
  const actor: CoreActor = { requestUrl: c.req.url, method: c.req.method }
  return {
    ...actor,
    ...(accessJwt !== undefined ? { accessJwt } : {}),
    ...(bearer !== undefined ? { bearer } : {}),
    ...(verified._tag === 'Some' ? { verifiedOauthGrant: verified.value } : {}),
  }
}

async function authFailureLimited(c: Context<HonoEnv>): Promise<boolean> {
  try {
    const count = await bumpRateCounter(
      c.env,
      `authfail:${c.req.header('CF-Connecting-IP') ?? '127.0.0.1'}`,
      parseInt(c.env.RATE_LIMIT_WINDOW_SECS ?? '60', 10),
    )
    return count > parseInt(c.env.RATE_LIMIT_AUTH_FAIL_MAX ?? '50', 10)
  } catch {
    return false
  }
}

export async function authMiddleware(c: Context<HonoEnv>, next: Next) {
  const actor = requestActor(c)
  try {
    const principal = await Effect.runPromise(
      decodeCoreReply(ApiPrincipal, makeCoreClient(c.env.CORE).apiAuthenticate(actor)),
    )
    const scopes = principal.tokenScopes
    if (scopes !== undefined && !c.req.path.startsWith('/mcp/')) {
      const required = capabilityForMethod(c.req.method)
      if (!tokenAllows(scopes, required)) return c.json({ error: `Token lacks '${required}' scope` }, 403)
    }
    c.set('coreActor', actor)
    c.set('user', principal.user)
    c.set('tokenWorkspaceId', principal.tokenWorkspaceId)
    c.set('tokenScopes', scopes === undefined ? undefined : [...scopes])
    c.set('authKind', principal.auth.kind)
    c.set('auth', {
      ...principal.auth,
      scopes: principal.auth.scopes === undefined ? undefined : [...principal.auth.scopes],
    })
    return next()
  } catch (error) {
    if (!(error instanceof CorePublicError)) throw error
    let status = error.status
    let message = error.message
    if (status === 401 && actor.bearer !== undefined && (await authFailureLimited(c))) {
      status = 429
      message = 'Too Many Requests'
    }
    const response = Response.json({ error: message }, { status })
    const workspaceId = mcpWorkspaceIdFromPath(c.req.path)
    if (status === 401 && workspaceId)
      response.headers.set('WWW-Authenticate', unauthorizedChallenge(c.req.url, workspaceId))
    return response
  }
}
