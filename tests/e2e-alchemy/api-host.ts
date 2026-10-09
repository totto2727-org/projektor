import * as D1 from '@alchemy.run/cloudflare-runtime/core/bindings/d1/D1'
import * as DurableObjectNamespace from '@alchemy.run/cloudflare-runtime/core/bindings/DurableObjectNamespace'
import * as KvNamespace from '@alchemy.run/cloudflare-runtime/core/bindings/kv-namespace/KvNamespace'
import * as R2Bucket from '@alchemy.run/cloudflare-runtime/core/bindings/r2-bucket/R2Bucket'
import * as Text from '@alchemy.run/cloudflare-runtime/core/bindings/Text'

/** Both actual Workers resolve these hooks through the same public plugin map. */
export const sharedApplicationBindings = [
  D1.local({ binding: 'DB', id: 'projektor-e2e-db' }),
  KvNamespace.local({ binding: 'KV', id: 'projektor-e2e-kv' }),
  KvNamespace.local({ binding: 'OAUTH_KV', id: 'projektor-e2e-oauth' }),
  R2Bucket.local({ binding: 'R2', id: 'projektor-e2e-files' }),
  ...Object.entries({
    ENVIRONMENT: 'development',
    DEV_USER_EMAIL: 'e2e@projektor.local',
    ADMIN_EMAILS: 'e2e@projektor.local',
    DEFAULT_WORKSPACE_SLUG: 'projektor',
    DEFAULT_WORKSPACE_NAME: 'Projektor E2E',
    AUTO_JOIN_ROLE: 'none',
    ALCHEMY_STACK_NAME: 'projektor-e2e',
    ALCHEMY_STAGE: 'test',
  }).map(([name, value]) => Text.local(name, value)),
]

/** Shared by the official API build and the public inline preview service. */
export const apiWorkerOptions = {
  name: 'projektor-e2e-api',
  durableObjectNamespaces: [
    { className: 'RateLimiter', sql: true },
    { className: 'WorkspaceHub', sql: true },
  ],
  bindings: [
    ...sharedApplicationBindings,
    DurableObjectNamespace.local({ binding: 'RATE_LIMITER', className: 'RateLimiter' }),
    DurableObjectNamespace.local({ binding: 'WORKSPACE_HUB', className: 'WorkspaceHub' }),
    Text.local('JWT_SECRET', 'test-only-not-a-production-secret'),
  ],
}
