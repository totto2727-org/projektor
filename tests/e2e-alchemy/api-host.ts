import * as D1 from '@alchemy.run/cloudflare-runtime/core/bindings/d1/D1'
import * as DurableObjectNamespace from '@alchemy.run/cloudflare-runtime/core/bindings/DurableObjectNamespace'
import * as KvNamespace from '@alchemy.run/cloudflare-runtime/core/bindings/kv-namespace/KvNamespace'
import * as R2Bucket from '@alchemy.run/cloudflare-runtime/core/bindings/r2-bucket/R2Bucket'
import * as Text from '@alchemy.run/cloudflare-runtime/core/bindings/Text'
import { Effect } from 'effect'

/** Stable service names inside the single isolated acceptance workerd. */
export const fixtureServices = {
  api: 'projektor-e2e-api-inline',
  core: 'projektor-e2e-core-inline',
}

export const applicationTextBindings = Object.entries({
  ENVIRONMENT: 'development',
  CF_ACCESS_TEAM_DOMAIN: '',
  CF_ACCESS_AUDIENCE: '',
  DEV_USER_EMAIL: 'e2e@projektor.local',
  ADMIN_EMAILS: 'e2e@projektor.local',
  DEFAULT_WORKSPACE_SLUG: 'projektor',
  DEFAULT_WORKSPACE_NAME: 'Projektor E2E',
  AUTO_JOIN_ROLE: 'none',
  ALCHEMY_STACK_NAME: 'projektor-e2e',
  ALCHEMY_STAGE: 'test',
}).map(([name, value]) => Text.local(name, value))

/** A genuine in-process native binding, not a registry proxy or loopback fetch. */
export const coreServiceBinding = Effect.succeed({ name: 'CORE', service: { name: fixtureServices.core } })
export const foreignRateLimiterBinding = Effect.succeed({
  name: 'RATE_LIMITER',
  durableObjectNamespace: { className: 'RateLimiter', serviceName: fixtureServices.api },
})

/** Core owns business storage. API shares only the official OAuth protocol namespace. */
export const coreWorkerOptions = {
  name: 'projektor-e2e-core',
  bindings: [
    ...applicationTextBindings,
    D1.local({ binding: 'DB', id: 'projektor-e2e-db' }),
    KvNamespace.local({ binding: 'KV', id: 'projektor-e2e-kv' }),
    KvNamespace.local({ binding: 'OAUTH_KV', id: 'projektor-e2e-oauth' }),
    R2Bucket.local({ binding: 'R2', id: 'projektor-e2e-files' }),
    foreignRateLimiterBinding,
  ],
}

/** Keep RateLimiter hosted by API. WorkspaceHub stays unbound, as in production. */
export const apiWorkerOptions = {
  name: 'projektor-e2e-api',
  durableObjectNamespaces: [{ className: 'RateLimiter', sql: true }],
  bindings: [
    ...applicationTextBindings,
    coreServiceBinding,
    KvNamespace.local({ binding: 'OAUTH_KV', id: 'projektor-e2e-oauth' }),
    DurableObjectNamespace.local({ binding: 'RATE_LIMITER', className: 'RateLimiter' }),
    Text.local('JWT_SECRET', 'test-only-not-a-production-secret'),
  ],
}
