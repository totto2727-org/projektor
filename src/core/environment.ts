import { WorkerEnvironment, WorkerExecutionContext } from 'alchemy/Cloudflare/Workers'
import { Effect } from 'effect'

import type { CoreEnv } from '../types/env'

/** Persistent resources belong to Core. OAuth signing stays in the API adapter. */
export type CoreEnvironment = Omit<CoreEnv, 'JWT_SECRET' | 'ASSETS'> & {
  /** Local-only lifecycle capability, created by the Worker and never serialized. */
  readonly invocation?: { readonly waitUntil: (promise: Promise<unknown>) => void }
}

export type CoreEnvironmentSource = Effect.Effect<CoreEnvironment, never, WorkerEnvironment | WorkerExecutionContext>

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    methods.every((key) => key in value && typeof Reflect.get(value, key) === 'function')
  )
}

/** Validate native binding capabilities at the sole untyped runtime boundary. */
export function isCoreEnvironment(value: unknown): value is CoreEnvironment {
  if (typeof value !== 'object' || value === null) return false
  const get = (key: string): unknown => Reflect.get(value, key)
  if (!hasMethods(get('DB'), ['prepare', 'batch', 'exec', 'withSession', 'dump'])) return false
  if (!hasMethods(get('KV'), ['get', 'put', 'delete', 'list', 'getWithMetadata'])) return false
  if (!hasMethods(get('OAUTH_KV'), ['get', 'put', 'delete', 'list', 'getWithMetadata'])) return false
  if (
    !hasMethods(get('R2'), ['get', 'head', 'put', 'delete', 'list', 'createMultipartUpload', 'resumeMultipartUpload'])
  )
    return false
  const environment = get('ENVIRONMENT')
  if (environment !== 'development' && environment !== 'staging' && environment !== 'production') return false
  if (typeof get('CF_ACCESS_TEAM_DOMAIN') !== 'string' || typeof get('CF_ACCESS_AUDIENCE') !== 'string') return false
  const optionalStrings = [
    'DEV_USER_EMAIL',
    'BOOTSTRAP_SECRET',
    'ADMIN_EMAILS',
    'DEFAULT_WORKSPACE_SLUG',
    'DEFAULT_WORKSPACE_NAME',
    'AUTO_JOIN_ROLE',
    'WORKSPACE_DOMAIN_MAP',
    'RATE_LIMIT_AUTH_MAX',
    'RATE_LIMIT_API_MAX',
    'RATE_LIMIT_WINDOW_SECS',
    'RATE_LIMIT_AUTH_FAIL_MAX',
    'RATE_LIMIT_FEEDBACK_MAX',
    'RATE_LIMIT_FEEDBACK_IP_MAX',
    'STORAGE_QUOTA_BYTES',
    'CORS_ALLOWED_ORIGINS',
    'WORKSPACE_SUBDOMAIN_ROUTING',
    'PUBLIC_READ_ONLY',
    'RATE_LIMIT_TEST_EPOCH',
    'RATE_LIMIT_TEST_NOW_MS',
    'BRAND_NAME',
    'BRAND_MARK',
    'BRAND_ACCENT',
    'BRAND_ON_ACCENT',
    'BRAND_LOGO_URL',
    'WIKI_NOTIFICATION_RETENTION_DAYS',
    'AGENT_SESSION_RETENTION_DAYS',
    'ACTIVITY_RETENTION_DAYS',
    'FILE_CLAIM_TTL_SECONDS',
  ] satisfies readonly (keyof CoreEnvironment)[]
  if (!optionalStrings.every((key) => get(key) === undefined || typeof get(key) === 'string')) return false
  for (const key of ['WORKSPACE_HUB', 'RATE_LIMITER']) {
    if (get(key) !== undefined && !hasMethods(get(key), ['idFromName', 'get'])) return false
  }
  if (get('invocation') !== undefined && !hasMethods(get('invocation'), ['waitUntil'])) return false
  return true
}

/** A stable Effect description, resolved anew inside each native invocation. */
export const coreEnvironment: CoreEnvironmentSource = Effect.gen(function* () {
  const env = yield* WorkerEnvironment
  const context = yield* WorkerExecutionContext
  const resolved: unknown = {
    ...env,
    invocation: { waitUntil: (promise: Promise<unknown>) => context.raw.waitUntil(promise) },
  }
  if (!isCoreEnvironment(resolved)) return yield* Effect.die(new Error('Invalid Core Worker bindings'))
  return resolved
})
