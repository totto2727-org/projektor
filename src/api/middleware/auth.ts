import { Effect, Schema } from 'effect'
import type { Context, Next } from 'hono'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { CorePublicError } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import { ApiPrincipal, VerifiedApiOauthGrant } from '../../contracts/api-auth.ts'
import type { ApiUser } from '../../contracts/api-auth.ts'
import { capabilityForMethod, tokenAllows } from '../../contracts/auth-scopes.ts'
import type { CoreActor } from '../../core/authorization.ts'
import { unauthorizedChallenge } from '../auth/challenge.ts'
import { bumpRateCounter } from './rate-limit.ts'
import { mcpWorkspaceIdFromPath } from './workspace.ts'

export type AuthUser = typeof ApiUser.Type

export function isPublicViewer(user: Readonly<{ email: string }>): boolean {
  return user.email === 'public-viewer@projektor.local'
}

export function requireInteractiveHuman(httpContext: Context<HonoEnv>, message: string): Response | null {
  const auth = httpContext.get('auth')
  if (auth?.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
    return httpContext.json({ error: message }, 403)
  }
  return null
}

const accessCookie = function accessCookie(cookie: string): string | undefined {
  return cookie
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('CF_Authorization='))
    ?.slice(17)
}

/** Only provider-created execution props, never public request headers, become OAuth proof. */
const requestActor = function requestActor(httpContext: Context<HonoEnv>): CoreActor {
  const authorization = httpContext.req.header('Authorization')
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
  const accessJwt =
    httpContext.req.header('Cf-Access-Jwt-Assertion') ?? accessCookie(httpContext.req.header('cookie') ?? '')
  const props: unknown = httpContext.executionCtx.props
  const verified = Schema.decodeUnknownOption(VerifiedApiOauthGrant)(props)
  const actor: CoreActor = { requestUrl: httpContext.req.url, method: httpContext.req.method }
  return {
    ...actor,
    ...(accessJwt !== undefined ? { accessJwt } : {}),
    ...(bearer !== undefined ? { bearer } : {}),
    ...(verified._tag === 'Some' ? { verifiedOauthGrant: verified.value } : {}),
  }
}

const authFailureLimited = async function authFailureLimited(httpContext: Context<HonoEnv>): Promise<boolean> {
  try {
    const count = await bumpRateCounter(
      httpContext.env,
      `authfail:${httpContext.req.header('CF-Connecting-IP') ?? '127.0.0.1'}`,
      parseInt(httpContext.env.RATE_LIMIT_WINDOW_SECS ?? '60', 10),
    )
    return count > parseInt(httpContext.env.RATE_LIMIT_AUTH_FAIL_MAX ?? '50', 10)
  } catch {
    return false
  }
}

export async function authMiddleware(httpContext: Context<HonoEnv>, next: Next) {
  const actor = requestActor(httpContext)
  try {
    const principal = await Effect.runPromise(
      decodeCoreReply(ApiPrincipal, makeCoreClient(httpContext.env.CORE).apiAuthenticate(actor)),
    )
    const scopes = principal.tokenScopes
    if (scopes !== undefined && !httpContext.req.path.startsWith('/mcp/')) {
      const required = capabilityForMethod(httpContext.req.method)
      if (!tokenAllows(scopes, required)) {
        return httpContext.json({ error: `Token lacks '${required}' scope` }, 403)
      }
    }
    httpContext.set('coreActor', actor)
    httpContext.set('user', principal.user)
    httpContext.set('tokenWorkspaceId', principal.tokenWorkspaceId)
    httpContext.set('tokenScopes', scopes === undefined ? undefined : [...scopes])
    httpContext.set('authKind', principal.auth.kind)
    httpContext.set('auth', {
      ...principal.auth,
      scopes: principal.auth.scopes === undefined ? undefined : [...principal.auth.scopes],
    })
    return next()
  } catch (error) {
    if (!(error instanceof CorePublicError)) {
      throw error
    }
    let status = error.status
    let message = error.message
    if (status === 401 && actor.bearer !== undefined && (await authFailureLimited(httpContext))) {
      status = 429
      message = 'Too Many Requests'
    }
    const response = Response.json({ error: message }, { status })
    const workspaceId = mcpWorkspaceIdFromPath(httpContext.req.path)
    if (status === 401 && workspaceId) {
      response.headers.set('WWW-Authenticate', unauthorizedChallenge(httpContext.req.url, workspaceId))
    }
    return response
  }
}
