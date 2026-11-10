import { Schema } from 'effect'

import { provisionPublicViewer } from '#commands/provisioning'
import type { ServiceCtx } from '#commands/types'
import {
  authenticateAccessJwt,
  authenticateDevelopment,
  BrowserAuthenticationError,
  type AuthUser,
  upsertUserByEmail,
} from '#services/authentication'
import type { AuthInfo, Role } from '#types'

import { capabilityForOAuthScope, parseScopes, tokenAllows, type Capability } from '../contracts/auth-scopes'
import { coreFailure } from './contract'
import type { CoreEnvironment } from './environment'

const VerifiedOauthGrant = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  name: Schema.String,
  workspaceId: Schema.String,
  scopes: Schema.Array(Schema.String),
  clientId: Schema.optional(Schema.String),
  credentialId: Schema.optional(Schema.String),
})

/** OAuth admission is supplied only by the bound API after provider verification. */
export const CoreActor = Schema.Struct({
  requestUrl: Schema.String,
  method: Schema.String,
  accessJwt: Schema.optional(Schema.String),
  bearer: Schema.optional(Schema.String),
  verifiedOauthGrant: Schema.optional(VerifiedOauthGrant),
})
export type CoreActor = typeof CoreActor.Type

export interface CorePrincipal {
  user: AuthUser
  auth: AuthInfo
  tokenWorkspaceId: string | null | undefined
  tokenScopes: string[] | undefined
}

export function requireCoreCapability(principal: CorePrincipal, requiredCapability: Capability): void {
  if (principal.tokenScopes !== undefined && !tokenAllows(principal.tokenScopes, requiredCapability)) {
    throw coreFailure(403, `Token lacks '${requiredCapability}' scope`)
  }
  if (principal.auth.method === 'public' && requiredCapability !== 'read') throw coreFailure(403, 'Forbidden')
}

const PUBLIC_VIEWER_EMAIL = 'public-viewer@projektor.local'
const RoleSchema = Schema.Literals(['owner', 'admin', 'member', 'viewer'])
const decodeActor = Schema.decodeUnknownSync(CoreActor)

/** Re-run on every operation. A returned principal is data, not a reusable capability. */
export async function resolveCorePrincipal(input: CoreActor, env: CoreEnvironment): Promise<CorePrincipal> {
  let actor: CoreActor
  let url: URL
  try {
    actor = decodeActor(input)
    url = new URL(actor.requestUrl)
  } catch {
    throw coreFailure(400, 'Invalid authentication request')
  }

  // Provider admission precedes opaque bearer lookup, as it does in the public API.
  if (actor.verifiedOauthGrant) {
    const grant = actor.verifiedOauthGrant
    const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?')
      .bind(grant.userId)
      .first<AuthUser>()
    if (!user || user.email !== grant.email) throw coreFailure(401, 'Unauthorized')
    const scopes = grant.scopes.map(capabilityForOAuthScope).filter((scope): scope is Capability => scope !== null)
    const parts = actor.bearer?.split(':')
    const credentialId = grant.credentialId ?? (parts?.length === 3 ? parts[1] : undefined)
    return {
      user,
      auth: { kind: 'agent', method: 'oauth', credentialId, clientId: grant.clientId, scopes },
      tokenWorkspaceId: grant.workspaceId,
      tokenScopes: scopes,
    }
  }

  if (actor.accessJwt !== undefined) {
    try {
      const principal = await authenticateAccessJwt(actor.accessJwt, env)
      return { ...principal, tokenWorkspaceId: undefined, tokenScopes: undefined }
    } catch (error) {
      if (error instanceof BrowserAuthenticationError) throw coreFailure(error.status, error.message)
      throw error
    }
  }

  if (actor.bearer !== undefined) return authenticateOpaqueToken(actor.bearer, env)

  // MCP must challenge unauthenticated connectors even when the UI dev bypass is on.
  if (!/^\/mcp\/[^/]+$/.test(url.pathname)) {
    const principal = await authenticateDevelopment(env)
    if (principal) return { ...principal, tokenWorkspaceId: undefined, tokenScopes: undefined }
  }
  if (['true', '1', 'yes'].includes(env.PUBLIC_READ_ONLY?.trim().toLowerCase() ?? '')) {
    const user = await upsertUserByEmail(PUBLIC_VIEWER_EMAIL, env.DB, env.KV)
    await provisionPublicViewer(env, user)
    return { user, auth: { kind: 'human', method: 'public' }, tokenWorkspaceId: undefined, tokenScopes: undefined }
  }
  throw coreFailure(401, 'Unauthorized')
}

async function authenticateOpaqueToken(token: string, env: CoreEnvironment): Promise<CorePrincipal> {
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
  if (!row || !row.user_id || !row.email || row.name === null) throw coreFailure(401, 'Unauthorized')
  if (row.expires_at !== null && row.expires_at < Date.now() / 1000) throw coreFailure(401, 'Token expired')
  const scopes = parseScopes(row.scopes)
  const now = Math.floor(Date.now() / 1000)
  if (!row.last_used_at || now - row.last_used_at >= 60) {
    const audit = env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?')
      .bind(now, hash)
      .run()
      .catch((cause: unknown) => {
        console.error('[core]', { operation: 'tokenAudit', occurrenceId: `urn:uuid:${crypto.randomUUID()}`, cause })
      })
    if (env.invocation) env.invocation.waitUntil(audit)
    else await audit
  }
  return {
    user: { id: row.user_id, email: row.email, name: row.name },
    auth: { kind: 'agent', method: token.startsWith('pk_') ? 'pk' : 'pat', credentialId: row.id, scopes },
    tokenWorkspaceId: row.workspace_id,
    tokenScopes: scopes,
  }
}

/** Build local capabilities only after current credential confinement and membership checks. */
export async function resolveCoreServiceCtx(
  actor: CoreActor,
  workspaceId: string,
  requiredCapability: Capability,
  env: CoreEnvironment,
): Promise<ServiceCtx> {
  const principal = await resolveCorePrincipal(actor, env)
  if (principal.tokenWorkspaceId != null && principal.tokenWorkspaceId !== workspaceId)
    throw coreFailure(403, 'Forbidden')
  requireCoreCapability(principal, requiredCapability)
  const row = await env.DB.prepare(`SELECT w.id, m.role FROM workspaces w LEFT JOIN workspace_members m
    ON m.workspace_id = w.id AND m.user_id = ? WHERE w.id = ?`)
    .bind(principal.user.id, workspaceId)
    .first<{ id: string; role: string | null }>()
  if (!row) throw coreFailure(404, 'Workspace not found')
  let role: Role
  try {
    role = Schema.decodeUnknownSync(RoleSchema)(row.role)
  } catch {
    throw coreFailure(403, 'Forbidden')
  }
  const ttl = Number(env.FILE_CLAIM_TTL_SECONDS)
  return {
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    userId: principal.user.id,
    workspaceId,
    role: principal.auth.method === 'public' ? 'viewer' : role,
    auth: principal.auth,
    authKind: principal.auth.kind,
    workspaceHub: env.WORKSPACE_HUB,
    waitUntil: env.invocation?.waitUntil,
    config: { fileClaimTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : 86400 },
  }
}
