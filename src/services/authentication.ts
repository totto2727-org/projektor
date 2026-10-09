import { Effect, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { z } from 'zod'

import { ensureUserProvisioned } from '#commands/provisioning'
import type { AuthInfo, Env } from '#types'

/** Only browser verification/provisioning capabilities, never OAuth signing secrets. */
export type BrowserAuthEnvironment = Pick<
  Env,
  | 'DB'
  | 'KV'
  | 'CF_ACCESS_TEAM_DOMAIN'
  | 'CF_ACCESS_AUDIENCE'
  | 'ENVIRONMENT'
  | 'DEV_USER_EMAIL'
  | 'ADMIN_EMAILS'
  | 'DEFAULT_WORKSPACE_SLUG'
  | 'DEFAULT_WORKSPACE_NAME'
  | 'AUTO_JOIN_ROLE'
  | 'WORKSPACE_DOMAIN_MAP'
>
export interface AuthUser {
  id: string
  email: string
  name: string
}
export interface BrowserPrincipal {
  user: AuthUser
  auth: AuthInfo
}
export class BrowserAuthenticationError extends Error {
  readonly _tag = 'BrowserAuthenticationError'
  constructor(
    readonly status: 401 | 503,
    message: string,
  ) {
    super(message)
    this.name = 'BrowserAuthenticationError'
  }
}

/** A present but invalid Access credential never falls back to a development identity. */
export async function authenticateBrowser(request: Request, env: BrowserAuthEnvironment): Promise<BrowserPrincipal> {
  const jwt =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    parseCookie(request.headers.get('cookie') ?? '', 'CF_Authorization')
  if (jwt) return authenticateAccessJwt(jwt, env)
  const principal = await authenticateDevelopment(env)
  if (principal) return principal
  throw new BrowserAuthenticationError(401, 'Unauthorized')
}

export async function authenticateAccessJwt(jwt: string, env: BrowserAuthEnvironment): Promise<BrowserPrincipal> {
  const parts = jwt.split('.')
  const decoded = parts.length === 3 ? decodeJwtFields(parts) : null
  const issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN}`
  if (!decoded || !jwtClaimsValid(decoded.header, decoded.payload, env.CF_ACCESS_AUDIENCE, issuer))
    throw new BrowserAuthenticationError(401, 'Invalid Access token')
  const keys = await getCfAccessKeysOrUnavailable(env)
  let result = await verifyJwtPayload(jwt, keys, env.CF_ACCESS_AUDIENCE, issuer)
  if (!result) {
    // Preserve the single rate-limited refresh on signing-key rotation.
    const freshKeys = await getCfAccessKeysOrUnavailable(env, { forceRefresh: true })
    if (freshKeys !== keys) result = await verifyJwtPayload(jwt, freshKeys, env.CF_ACCESS_AUDIENCE, issuer)
  }
  if (!result) throw new BrowserAuthenticationError(401, 'Invalid Access token')
  const user = await upsertUserByEmail(result.email, env.DB, env.KV)
  await ensureUserProvisioned(env, user)
  return { user, auth: { kind: 'human', method: 'access' } }
}

export async function authenticateDevelopment(env: BrowserAuthEnvironment): Promise<BrowserPrincipal | null> {
  if (env.ENVIRONMENT !== 'development' || !env.DEV_USER_EMAIL) return null
  const user = await upsertUserByEmail(env.DEV_USER_EMAIL, env.DB)
  await ensureUserProvisioned(env, user)
  return { user, auth: { kind: 'human', method: 'dev' } }
}

const JwtHeaderSchema = z.object({ alg: z.string(), kid: z.string().optional() })
const JwtPayloadSchema = z.object({
  exp: z.number(),
  iat: z.number().optional(),
  aud: z.union([z.string(), z.array(z.string())]),
  iss: z.string(),
  email: z.string().min(1).optional(),
})
type JwtHeader = z.infer<typeof JwtHeaderSchema>
type JwtPayload = z.infer<typeof JwtPayloadSchema>
function decodeJwtFields(parts: readonly string[]): { header: JwtHeader; payload: JwtPayload } | null {
  try {
    const header = JwtHeaderSchema.safeParse(JSON.parse(base64urlDecode(parts[0])))
    const payload = JwtPayloadSchema.safeParse(JSON.parse(base64urlDecode(parts[1])))
    return header.success && payload.success ? { header: header.data, payload: payload.data } : null
  } catch {
    return null
  }
}
function jwtClaimsValid(
  header: JwtHeader,
  payload: JwtPayload,
  audience: string,
  issuer: string,
): payload is JwtPayload & { email: string } {
  if (header.alg !== 'RS256' || payload.exp < Math.floor(Date.now() / 1000)) return false
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  return audiences.includes(audience) && payload.iss === issuer && typeof payload.email === 'string'
}
/** Injectable keys preserve the API's native regression verifier contract. */
export async function verifyJwtPayload(
  jwt: string,
  keys: JsonWebKey[],
  audience: string,
  issuer: string,
): Promise<{ email: string } | null> {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const decoded = decodeJwtFields(parts)
  if (!decoded || !jwtClaimsValid(decoded.header, decoded.payload, audience, issuer)) return null
  let sig: Uint8Array<ArrayBuffer>
  try {
    sig = Uint8Array.from(base64urlDecode(parts[2]), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
  const input = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  for (const jwk of keys) {
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
        'verify',
      ])
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, input)) return { email: decoded.payload.email }
    } catch {}
  }
  return null
}

// Access JWKS is public, independent of the API Worker transport or JWT_SECRET.
const JwksSchema = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kty: Schema.String,
      kid: Schema.optional(Schema.String),
      alg: Schema.optional(Schema.String),
      use: Schema.optional(Schema.String),
      n: Schema.optional(Schema.String),
      e: Schema.optional(Schema.String),
      ext: Schema.optional(Schema.Boolean),
      key_ops: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})
let inMemoryCertsCache: { keys: JsonWebKey[]; expiresAt: number } | null = null
let lastForcedRefreshAt = 0
const CERTS_LOCAL_TTL_MS = 3600 * 1000
const FORCE_REFRESH_COOLDOWN_MS = 60 * 1000
async function fetchAndCacheCfAccessKeys(env: BrowserAuthEnvironment): Promise<JsonWebKey[]> {
  const request = HttpClientRequest.get(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)
  const body = await Effect.runPromise(
    HttpClient.execute(request).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? HttpClientResponse.schemaBodyJson(JwksSchema)(response)
          : Effect.fail(new Error('Failed to fetch CF Access certs')),
      ),
      Effect.scoped,
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
    ),
  )
  const keys: JsonWebKey[] = body.keys.map(({ key_ops, ...key }) => ({
    ...key,
    ...(key_ops ? { key_ops: [...key_ops] } : {}),
  }))
  try {
    await env.KV.put('cf-access-certs', JSON.stringify(keys), { expirationTtl: 3600 })
  } catch (err) {
    console.error('[auth] failed to cache cf-access-certs in KV, continuing without it:', err)
  }
  inMemoryCertsCache = { keys, expiresAt: Date.now() + CERTS_LOCAL_TTL_MS }
  return keys
}
async function getCfAccessKeysOrUnavailable(
  env: BrowserAuthEnvironment,
  opts?: { forceRefresh?: boolean },
): Promise<JsonWebKey[]> {
  try {
    return await getCfAccessKeys(env, opts)
  } catch {
    throw new BrowserAuthenticationError(503, 'Authentication temporarily unavailable')
  }
}
async function getCfAccessKeys(env: BrowserAuthEnvironment, opts?: { forceRefresh?: boolean }): Promise<JsonWebKey[]> {
  if (opts?.forceRefresh && Date.now() - lastForcedRefreshAt >= FORCE_REFRESH_COOLDOWN_MS) {
    lastForcedRefreshAt = Date.now()
    return fetchAndCacheCfAccessKeys(env)
  }
  if (inMemoryCertsCache && inMemoryCertsCache.expiresAt > Date.now()) return inMemoryCertsCache.keys
  let cached: unknown
  try {
    cached = await env.KV.get('cf-access-certs', 'json')
  } catch (err) {
    console.error('[auth] failed to read cf-access-certs from KV, fetching fresh:', err)
  }
  if (cached) {
    const keys = cached as JsonWebKey[]
    inMemoryCertsCache = { keys, expiresAt: Date.now() + CERTS_LOCAL_TTL_MS }
    return keys
  }
  return fetchAndCacheCfAccessKeys(env)
}
const inMemoryUserCache = new Map<string, { user: AuthUser; expiresAt: number }>()
const USER_LOCAL_TTL_MS = 300 * 1000
export function resetAuthCachesForTests(): void {
  inMemoryCertsCache = null
  inMemoryUserCache.clear()
}
/** Shared by Access/dev and the API-only opt-in public identity strategy. */
export async function upsertUserByEmail(email: string, db: D1Database, kv?: KVNamespace): Promise<AuthUser> {
  const local = inMemoryUserCache.get(email)
  if (local && local.expiresAt > Date.now()) return local.user
  if (kv) {
    let cached: unknown
    try {
      cached = await kv.get(`user-by-email:${email}`, 'json')
    } catch (err) {
      console.error(`[auth] failed to read user-by-email:${email} from KV, continuing:`, err)
    }
    if (cached) {
      const user = cached as AuthUser
      inMemoryUserCache.set(email, { user, expiresAt: Date.now() + USER_LOCAL_TTL_MS })
      return user
    }
  }
  await db
    .prepare(`INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name`)
    .bind(crypto.randomUUID(), email, email.split('@')[0], Math.floor(Date.now() / 1000))
    .run()
  const user = await db.prepare('SELECT id, email, name FROM users WHERE email = ?').bind(email).first<AuthUser>()
  if (!user) throw new Error('Failed to upsert user')
  if (kv) {
    try {
      await kv.put(`user-by-email:${email}`, JSON.stringify(user), { expirationTtl: 300 })
    } catch (err) {
      console.error(`[auth] failed to cache user-by-email:${email} in KV, continuing without it:`, err)
    }
  }
  inMemoryUserCache.set(email, { user, expiresAt: Date.now() + USER_LOCAL_TTL_MS })
  return user
}
export function parseCookie(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key.trim() === name) return rest.join('=').trim()
  }
  return undefined
}
function base64urlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (value.length % 4)) % 4)
  return atob(padded)
}
