import { Predicate, Schema } from 'effect'

import { provisionPublicViewer } from '#commands/provisioning.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { VerifiedApiOauthGrant } from '#contracts/api-auth.ts'
import { capabilityForOAuthScope, parseScopes, tokenAllows } from '#contracts/auth-scopes.ts'
import type { Capability } from '#contracts/auth-scopes.ts'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_UNAUTHORIZED } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_DAY,
  SECONDS_PER_MINUTE,
  currentEpochMilliseconds,
  currentEpochSeconds,
} from '#contracts/time.ts'
import {
  authenticateAccessJwt,
  authenticateDevelopment,
  BrowserAuthenticationError,
  upsertUserByEmail,
} from '#services/authentication.ts'
import type { AuthUser } from '#services/authentication.ts'
import type { AuthInfo, Role } from '#types'

import { coreFailure } from './contract.ts'
import type { CoreEnvironment } from './environment.ts'

/** OAuth admission is supplied only by the bound API after provider verification. */
export const CoreActor = Schema.Struct({
  requestUrl: Schema.String,
  method: Schema.String,
  accessJwt: Schema.optional(Schema.String),
  bearer: Schema.optional(Schema.String),
  verifiedOauthGrant: Schema.optional(VerifiedApiOauthGrant),
})
export type CoreActor = typeof CoreActor.Type

export interface CorePrincipal {
  user: AuthUser
  auth: AuthInfo & Readonly<{ workspaceId?: string | null }>
  tokenWorkspaceId: string | null | undefined
  tokenScopes: string[] | undefined
}

export const requireCoreCapability = function requireCoreCapability(
  principal: CorePrincipal,
  requiredCapability: Capability,
): void {
  if (Predicate.isNotNullish(principal.tokenScopes) && !tokenAllows(principal.tokenScopes, requiredCapability)) {
    throw coreFailure(HTTP_FORBIDDEN, `Token lacks '${requiredCapability}' scope`)
  }
  if (principal.auth.method === 'public' && requiredCapability !== 'read') {
    throw coreFailure(HTTP_FORBIDDEN, 'Forbidden')
  }
}

const TOKEN_USAGE_WRITE_INTERVAL_SECONDS = SECONDS_PER_MINUTE
const PUBLIC_VIEWER_EMAIL = 'public-viewer@projektor.local'
const RoleSchema = Schema.Literals(['owner', 'admin', 'member', 'viewer'])
const decodeActor = Schema.decodeUnknownSync(CoreActor)

const authenticateOpaqueToken = async function authenticateOpaqueToken(
  token: string,
  env: CoreEnvironment,
): Promise<CorePrincipal> {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  const row = await env.DB.prepare(`SELECT at.id, at.workspace_id, at.expires_at, at.scopes, at.last_used_at,
    u.id AS user_id, u.email, u.name FROM api_tokens at LEFT JOIN users u ON u.id = at.user_id
    WHERE at.token_hash = ?`)
    .bind(hash)
    .first<{
      id: string
      workspace_id: string | null
      expires_at: number | null
      scopes: string | null
      last_used_at: number | null
      user_id: string | null
      email: string | null
      name: string | null
    }>()
  if (!row || !row.user_id || !row.email || Predicate.isNullish(row.name)) {
    throw coreFailure(HTTP_UNAUTHORIZED, 'Unauthorized')
  }
  if (Predicate.isNotNullish(row.expires_at) && row.expires_at < currentEpochMilliseconds() / MILLISECONDS_PER_SECOND) {
    throw coreFailure(HTTP_UNAUTHORIZED, 'Token expired')
  }
  const scopes = parseScopes(row.scopes)
  const now = currentEpochSeconds()
  if (!row.last_used_at || now - row.last_used_at >= TOKEN_USAGE_WRITE_INTERVAL_SECONDS) {
    const audit = env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?')
      .bind(now, hash)
      .run()
      .catch((cause: unknown) => {
        console.error('[core]', { operation: 'tokenAudit', occurrenceId: `urn:uuid:${crypto.randomUUID()}`, cause })
      })
    if (env.invocation) {
      env.invocation.waitUntil(audit)
    } else {
      await audit
    }
  }
  return fieldsInOrder([
    ['user', { id: row.user_id, email: row.email, name: row.name }],
    [
      'auth',
      {
        kind: 'agent',
        method: token.startsWith('pk_') ? 'pk' : 'pat',
        credentialId: row.id,
        scopes,
        workspaceId: row.workspace_id,
      },
    ],
    ['tokenWorkspaceId', row.workspace_id],
    ['tokenScopes', scopes],
  ])
}

/**
 * Re-run on every operation. A returned principal is data, not a reusable capability.
 *
 * @param {CoreActor} input Request identity and credentials supplied by the calling adapter.
 * @param {CoreEnvironment} env Core authentication configuration and bindings.
 * @returns {Promise<CorePrincipal>} The authenticated user and their current credential restrictions.
 */
export const resolveCorePrincipal = async function resolveCorePrincipal(
  input: CoreActor,
  env: CoreEnvironment,
): Promise<CorePrincipal> {
  let actor: CoreActor
  let url: URL
  try {
    actor = decodeActor(input)
    url = new URL(actor.requestUrl)
  } catch {
    throw coreFailure(HTTP_BAD_REQUEST, 'Invalid authentication request')
  }

  // Provider admission precedes opaque bearer lookup, as it does in the public API.
  if (actor.verifiedOauthGrant) {
    const grant = actor.verifiedOauthGrant
    const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?')
      .bind(grant.userId)
      .first<AuthUser>()
    if (!user || user.email !== grant.email) {
      throw coreFailure(HTTP_UNAUTHORIZED, 'Unauthorized')
    }
    const scopes = grant.scopes
      .map(capabilityForOAuthScope)
      .filter((scope): scope is Capability => Predicate.isNotNullish(scope))
    const parts = actor.bearer?.split(':')
    const credentialId = grant.credentialId ?? (parts?.length === 3 ? parts[1] : undefined)
    return fieldsInOrder([
      ['user', user],
      [
        'auth',
        {
          kind: 'agent',
          method: 'oauth',
          credentialId,
          clientId: grant.clientId,
          scopes,
          workspaceId: grant.workspaceId,
        },
      ],
      ['tokenWorkspaceId', grant.workspaceId],
      ['tokenScopes', scopes],
    ])
  }

  if (Predicate.isNotNullish(actor.accessJwt)) {
    try {
      const principal = await authenticateAccessJwt(actor.accessJwt, env)
      return {
        ...principal,
        ...fieldsInOrder([
          ['tokenWorkspaceId', undefined],
          ['tokenScopes', undefined],
        ]),
      }
    } catch (error) {
      if (error instanceof BrowserAuthenticationError) {
        throw coreFailure(error.status, error.message)
      }
      throw error
    }
  }

  if (Predicate.isNotNullish(actor.bearer)) {
    return authenticateOpaqueToken(actor.bearer, env)
  }

  // MCP must challenge unauthenticated connectors even when the UI dev bypass is on.
  if (!/^\/mcp\/[^/]+$/u.test(url.pathname)) {
    const principal = await authenticateDevelopment(env)
    if (principal) {
      return {
        ...principal,
        ...fieldsInOrder([
          ['tokenWorkspaceId', undefined],
          ['tokenScopes', undefined],
        ]),
      }
    }
  }
  if (['true', '1', 'yes'].includes(env.PUBLIC_READ_ONLY?.trim().toLowerCase() ?? '')) {
    const user = await upsertUserByEmail(PUBLIC_VIEWER_EMAIL, env.DB, env.KV)
    await provisionPublicViewer(env, user)
    return fieldsInOrder([
      ['user', user],
      ['auth', { kind: 'human', method: 'public' }],
      ['tokenWorkspaceId', undefined],
      ['tokenScopes', undefined],
    ])
  }
  throw coreFailure(HTTP_UNAUTHORIZED, 'Unauthorized')
}

/**
 * Build local capabilities only after current credential confinement and membership checks.
 *
 * @param {CoreActor} actor Request identity and credentials for the operation.
 * @param {string} workspaceId Workspace the operation will access.
 * @param {Capability} requiredCapability Permission required by the operation.
 * @param {CoreEnvironment} env Core configuration and local service bindings.
 * @returns {Promise<ServiceCtx>} The service context for the authorized workspace and current principal.
 */
export const resolveCoreServiceCtx = async function resolveCoreServiceCtx(
  actor: CoreActor,
  workspaceId: string,
  requiredCapability: Capability,
  env: CoreEnvironment,
): Promise<ServiceCtx> {
  const principal = await resolveCorePrincipal(actor, env)
  if (Predicate.isNotNullish(principal.tokenWorkspaceId) && principal.tokenWorkspaceId !== workspaceId) {
    throw coreFailure(HTTP_FORBIDDEN, 'Forbidden')
  }
  requireCoreCapability(principal, requiredCapability)
  const row = await env.DB.prepare(`SELECT w.id, m.role FROM workspaces w LEFT JOIN workspace_members m
    ON m.workspace_id = w.id AND m.user_id = ? WHERE w.id = ?`)
    .bind(principal.user.id, workspaceId)
    .first<{ id: string; role: string | null }>()
  if (!row) {
    throw coreFailure(HTTP_NOT_FOUND, 'Workspace not found')
  }
  let role: Role
  try {
    role = Schema.decodeUnknownSync(RoleSchema)(row.role)
  } catch {
    throw coreFailure(HTTP_FORBIDDEN, 'Forbidden')
  }
  const ttl = Number(env.FILE_CLAIM_TTL_SECONDS)
  return fieldsInOrder([
    ['db', env.DB],
    ['kv', env.KV],
    ['r2', env.R2],
    ['userId', principal.user.id],
    ['workspaceId', workspaceId],
    ['role', principal.auth.method === 'public' ? 'viewer' : role],
    ['auth', principal.auth],
    ['authKind', principal.auth.kind],
    ['workspaceHub', env.WORKSPACE_HUB],
    ['waitUntil', env.invocation?.waitUntil],
    ['config', { fileClaimTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : SECONDS_PER_DAY }],
  ])
}
