import { String, Predicate, Schema } from 'effect'
import type { Context, Next } from 'hono'
import { makeCoreClient, CorePublicError } from 'projektor/core-client'

import { unauthorizedChallenge } from '#api/auth/challenge.ts'
import { apiReply } from '#api/services/reply.ts'
import { ApiPrincipal, VerifiedApiOauthGrant } from '#contracts/api-auth.ts'
import type { ApiUser } from '#contracts/api-auth.ts'
import { capabilityForMethod, tokenAllows } from '#contracts/auth-scopes.ts'
import { HTTP_TOO_MANY_REQUESTS, HTTP_UNAUTHORIZED, HTTP_FORBIDDEN } from '#contracts/http-status.ts'
import { parseRateLimitSetting } from '#contracts/request-rate-limit.ts'
import type { CoreActor } from '#core/authorization.ts'
import type { HonoEnv } from '#types'

import { bumpRateCounter } from './rate-limit.ts'
import { mcpWorkspaceIdFromPath } from './workspace.ts'

export type AuthUser = typeof ApiUser.Type

export const isPublicViewer = function isPublicViewer(user: Readonly<{ email: string }>): boolean {
  return user.email === 'public-viewer@projektor.local'
}

export const requireInteractiveHuman = function requireInteractiveHuman(
  httpContext: Context<HonoEnv>,
  message: string,
): Response | null {
  const auth = httpContext.get('auth')
  if (auth?.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
    return httpContext.json({ error: message }, HTTP_FORBIDDEN)
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
const decodeVerifiedOauthGrant = Schema.decodeUnknownOption(VerifiedApiOauthGrant)

const requestActor = function requestActor(httpContext: Context<HonoEnv>): CoreActor {
  const authorization = httpContext.req.header('Authorization')
  const bearer = authorization?.startsWith('Bearer ') === true ? authorization.slice(7) : undefined
  const accessJwt =
    httpContext.req.header('Cf-Access-Jwt-Assertion') ?? accessCookie(httpContext.req.header('cookie') ?? '')
  const props: unknown = httpContext.executionCtx.props
  const verified = decodeVerifiedOauthGrant(props)
  const actor: CoreActor = { requestUrl: httpContext.req.url, method: httpContext.req.method }
  return {
    ...actor,
    ...(Predicate.isNotNullish(accessJwt) ? { accessJwt } : {}),
    ...(Predicate.isNotNullish(bearer) ? { bearer } : {}),
    ...(verified._tag === 'Some' ? { verifiedOauthGrant: verified.value } : {}),
  }
}

const authFailureLimited = async function authFailureLimited(httpContext: Context<HonoEnv>): Promise<boolean> {
  try {
    const count = await bumpRateCounter(
      httpContext.env,
      `authfail:${httpContext.req.header('CF-Connecting-IP') ?? '127.0.0.1'}`,
      parseRateLimitSetting(httpContext.env.RATE_LIMIT_WINDOW_SECS ?? '60'),
    )
    return count > parseRateLimitSetting(httpContext.env.RATE_LIMIT_AUTH_FAIL_MAX ?? '50')
  } catch {
    return false
  }
}

export const authMiddleware = async function authMiddleware(
  httpContext: Context<HonoEnv>,
  next: Next,
): Promise<void | Response> {
  const actor = requestActor(httpContext)
  try {
    const principal = await apiReply(ApiPrincipal, makeCoreClient(httpContext.env.CORE).apiAuthenticate(actor))
    const scopes = principal.tokenScopes
    if (Predicate.isNotNullish(scopes) && !httpContext.req.path.startsWith('/mcp/')) {
      const required = capabilityForMethod(httpContext.req.method)
      if (!tokenAllows(scopes, required)) {
        return httpContext.json({ error: `Token lacks '${required}' scope` }, HTTP_FORBIDDEN)
      }
    }
    httpContext.set('coreActor', actor)
    httpContext.set('user', principal.user)
    httpContext.set('tokenWorkspaceId', principal.tokenWorkspaceId)
    httpContext.set('tokenScopes', Predicate.isNullish(scopes) ? undefined : [...scopes])
    httpContext.set('authKind', principal.auth.kind)
    httpContext.set('auth', {
      ...principal.auth,
      scopes: Predicate.isNullish(principal.auth.scopes) ? undefined : [...principal.auth.scopes],
    })
    // oxlint-disable-next-line typescript/return-await -- This catch handles synchronous continuation failures. Downstream rejections still reach Hono.
    return next()
  } catch (error) {
    if (!(error instanceof CorePublicError)) {
      throw error
    }
    let { status } = error
    let { message } = error
    if (
      status === HTTP_UNAUTHORIZED &&
      Predicate.isNotNullish(actor.bearer) &&
      (await authFailureLimited(httpContext))
    ) {
      status = HTTP_TOO_MANY_REQUESTS
      message = 'Too Many Requests'
    }
    const response = Response.json({ error: message }, { status })
    const workspaceId = mcpWorkspaceIdFromPath(httpContext.req.path)
    if (status === HTTP_UNAUTHORIZED && Predicate.isNotNullish(workspaceId) && String.isNonEmpty(workspaceId)) {
      response.headers.set('WWW-Authenticate', unauthorizedChallenge(httpContext.req.url, workspaceId))
    }
    return response
  }
}
