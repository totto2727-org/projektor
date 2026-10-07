import { Stack } from 'alchemy'
import { AdoptPolicy } from 'alchemy/AdoptPolicy'
import { CloudflareEnvironment, Providers } from 'alchemy/Cloudflare'
import { dedupeBindings, diffBindings } from 'alchemy/Diff'
import * as Output from 'alchemy/Output'
import { ConfigProvider, Effect, Redacted } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import Frontend, {
  LocalDatabase,
  LocalLayer,
  ProductionLayer,
  WorkerResources,
  deployment,
  existingStorageBindings,
  localDevelopment,
} from './alchemy'
import { workers } from './alchemy.run'

function configured<A, E, R>(effect: Effect.Effect<A, E, R>, values: Record<string, string>) {
  return effect.pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values)))
}

async function registerApi(
  local: boolean,
  accountId = deployment.accountId,
  productionSecret: string | null = 'test-existing-production-value',
  environmentLayer?: typeof LocalLayer | typeof ProductionLayer,
  extraConfig: Record<string, string> = {},
) {
  const stack: Stack['Service'] = {
    name: 'projektor',
    stage: local ? 'dev' : 'production',
    resources: {},
    bindings: {},
    actions: {},
  }
  const { api, frontend } = await Effect.runPromise(
    configured(environmentLayer ? WorkerResources.pipe(Effect.provide(environmentLayer)) : workers, {
      ALCHEMY_DEV: local ? 'true' : 'false',
      ...(productionSecret === null ? {} : { JWT_SECRET: productionSecret }),
      ...extraConfig,
    }).pipe(
      Effect.provideService(Stack, stack),
      Effect.provideService(AdoptPolicy, true),
      Effect.provideService(
        CloudflareEnvironment,
        Effect.succeed({
          type: 'apiToken',
          apiToken: Redacted.make('unused-test-only-token'),
          accountId,
          source: { type: 'env' },
        }),
      ),
      // Registration must not call any provider. A deliberately empty
      // collection keeps these tests independent of credentials/cloud APIs.
      Effect.provideService(Providers, {
        kind: 'ProviderCollection',
        providers: {},
        get: () => undefined,
      }),
    ),
  )
  return { api, frontend, stack }
}

describe('source-owned deployment configuration', () => {
  it.each([false, true])('captures env.API without deployment inputs in runtime (dev=%s)', async (local) => {
    const stack: Stack['Service'] = {
      name: 'projektor',
      stage: 'testhost',
      resources: {},
      bindings: {},
      actions: {},
    }
    const reads: string[] = []
    const provider = ConfigProvider.make((path) => {
      const key = path.join('.')
      reads.push(key)
      if (key === 'ALCHEMY_PHASE') return Effect.succeed(ConfigProvider.makeValue('runtime'))
      if (key === 'ALCHEMY_DEV') return Effect.succeed(ConfigProvider.makeValue(String(local)))
      return Effect.die(new Error(`Runtime read deployment input ${key}`))
    })
    await Effect.runPromise(
      Frontend.pipe(
        Effect.map((frontend) => ({ frontend })),
        Effect.provideService(Stack, stack),
        Effect.provideService(ConfigProvider.ConfigProvider, provider),
        Effect.provideService(CloudflareEnvironment, Effect.die(new Error('Runtime resolved deployment profile'))),
        Effect.provideService(Providers, {
          kind: 'ProviderCollection',
          providers: {},
          get: () => {
            throw new Error('Runtime resolved lifecycle provider')
          },
        }),
      ),
    )
    expect(Object.keys(stack.resources).sort()).toEqual(['Api', 'Frontend'])
    expect(stack.resources.Api.Props).not.toHaveProperty('env')
    expect(stack.resources.Frontend.Props.env).not.toHaveProperty('DB')
    expect(stack.bindings.Frontend.some((entry) => entry.sid === 'external-database')).toBe(false)
    expect(stack.bindings.Api ?? []).toEqual([])
    expect(new Set(reads)).toEqual(new Set(['ALCHEMY_PHASE']))
    const binding = stack.bindings.Frontend.flatMap((entry) => entry.data.bindings ?? [])[0]
    expect(binding.type).toBe('service')
    expect(binding.name).toBe('API')
    expect(Output.isOutput(binding.service)).toBe(true)
    expect(binding.service.kind).toBe('PropExpr')
    expect(binding.service.identifier).toBe('workerName')
    expect(binding.service.expr.src.LogicalId).toBe('Api')
  })

  it('registers both retained production Workers with storage scoped to each', async () => {
    const { frontend, stack } = await registerApi(false)
    if (!frontend) throw new Error('Missing Frontend')
    expect(Object.keys(stack.resources).sort()).toEqual(['Api', 'Frontend'])
    expect(frontend.RemovalPolicy).toBe('retain')
    expect(frontend.Adopt).toBe(true)
    expect(frontend.Props).toMatchObject({
      name: 'projektor-frontend',
      workersDev: { enabled: false, previewsEnabled: false },
      domain: { name: 'projektor.totto2727.dev', previews: false },
      vite: { rootDir: '.', viteEnvironments: { entry: 'rsc', children: ['ssr'] } },
    })
    expect(frontend.Props.main).toMatch(/\/alchemy\.ts$/)
    expect(frontend.Props).not.toHaveProperty('access')
    expect(frontend.Props).not.toHaveProperty('migrations')
    const bindings = stack.bindings.Frontend.flatMap((entry) => entry.data.bindings ?? [])
    expect(bindings.filter((binding) => binding.type !== 'service')).toEqual([
      { type: 'plain_text', name: 'API_BASE', text: deployment.api.origin },
      existingStorageBindings()[0],
    ])
    expect(bindings).toContainEqual(expect.objectContaining({ type: 'service', name: 'API' }))
  })

  it('shares one native local database between API and Frontend', async () => {
    const { api, frontend, stack } = await registerApi(true)
    if (!frontend) throw new Error('Missing Frontend')
    const { db } = await Effect.runPromise(
      LocalDatabase.pipe(
        Effect.map((db) => ({ db })),
        Effect.provideService(Stack, stack),
        Effect.provideService(Providers, {
          kind: 'ProviderCollection',
          providers: {},
          get: () => undefined,
        }),
      ),
    )
    expect(api.Props.env).toMatchObject({ DB: db })
    expect(frontend.Props.env).toMatchObject({ DB: db })
    expect(stack.resources.LocalDatabase).toBe(db)
    expect(Object.keys(stack.resources).filter((id) => id === 'LocalDatabase')).toHaveLength(1)
  })
  it('registers both production Workers without custom account or Access confirmation gates', async () => {
    const { stack } = await registerApi(false, 'different-account')
    expect(Object.keys(stack.resources).sort()).toEqual(['Api', 'Frontend'])
  })

  it('inherits the existing production JWT secret without requiring or reading its value', async () => {
    const { api, stack } = await registerApi(false, deployment.accountId, null)
    expect(api.Props.env).not.toHaveProperty('JWT_SECRET')
    const bindings = dedupeBindings(stack.bindings.Api).flatMap((entry) => entry.data.bindings ?? [])
    expect(bindings.filter((binding) => binding.name === 'JWT_SECRET')).toEqual([
      { type: 'inherit', name: 'JWT_SECRET' },
    ])
    const frontendBindings = stack.bindings.Frontend.flatMap((entry) => entry.data.bindings ?? [])
    expect(frontendBindings.some((binding) => binding.name === 'JWT_SECRET')).toBe(false)
    for (const binding of existingStorageBindings()) expect(bindings).toContainEqual(binding)
  })

  it('switches initial secret configuration to stable inheritance on subsequent deployments', async () => {
    const initial = await registerApi(false)
    const inherited = await registerApi(false, deployment.accountId, null)
    const repeated = await registerApi(false, deployment.accountId, null)
    const changes = diffBindings(initial.stack.bindings.Api, inherited.stack.bindings.Api)
    // Alchemy's apply path excludes deleted binding rows before provider reconciliation.
    const activeJwt = changes
      .filter((entry) => entry.action !== 'delete')
      .flatMap((entry) => entry.data.bindings ?? [])
      .filter((binding) => binding.name === 'JWT_SECRET')
    expect(activeJwt).toEqual([{ type: 'inherit', name: 'JWT_SECRET' }])
    expect(changes.some((entry) => entry.action === 'delete')).toBe(true)
    expect(
      diffBindings(inherited.stack.bindings.Api, repeated.stack.bindings.Api).every((entry) => entry.action === 'noop'),
    ).toBe(true)
  })

  it('registers the retained native API Worker and external storage in production', async () => {
    const { api, stack } = await registerApi(false)
    expect(Object.keys(stack.resources).sort()).toEqual(['Api', 'Frontend'])
    expect(api.RemovalPolicy).toBe('retain')
    expect(api.Adopt).toBe(true)
    const env = api.Props.env
    if (!env) throw new Error('Production Worker is missing its environment')
    if (!('JWT_SECRET' in env) || !Redacted.isRedacted(env.JWT_SECRET)) {
      throw new Error('Expected a redacted JWT secret')
    }
    expect(Redacted.value(env.JWT_SECRET)).toBe('test-existing-production-value')
    expect(api.Props).toMatchObject({
      name: 'projektor',
      main: './src/api/index.ts',
      workersDev: { enabled: false, previewsEnabled: false },
      domain: { name: 'projektor-api.totto2727.dev', previews: false },
      crons: ['0 3 * * *'],
    })
    expect(api.Props).not.toHaveProperty('access')
    expect(api.Props).not.toHaveProperty('migrations')
    const bindings = dedupeBindings(stack.bindings.Api).flatMap((entry) => entry.data.bindings ?? [])
    expect(bindings.filter((binding) => binding.name === 'JWT_SECRET')).toEqual([
      { type: 'secret_text', name: 'JWT_SECRET', text: 'test-existing-production-value' },
    ])
    for (const binding of existingStorageBindings()) expect(bindings).toContainEqual(binding)
    expect(bindings).toContainEqual(
      expect.objectContaining({
        type: 'durable_object_namespace',
        name: 'RATE_LIMITER',
        className: 'RateLimiter',
      }),
    )
    expect(bindings.some((binding) => binding.className === 'WorkspaceHub')).toBe(false)
  })

  it('declares separate local storage with local-only migrations for dev', async () => {
    const { api, stack } = await registerApi(true)
    expect(Object.keys(stack.resources).sort()).toEqual([
      'Api',
      'Frontend',
      'LocalCache',
      'LocalDatabase',
      'LocalFiles',
      'LocalOAuth',
    ])
    expect(stack.resources.LocalDatabase.Props).toMatchObject({
      name: 'projektor-local',
      migrations: './migrations',
    })
    expect(api.Adopt).toBe(false)
    expect(api.Props.env).toMatchObject({
      ENVIRONMENT: 'development',
      DEV_USER_EMAIL: localDevelopment.userEmail,
    })
    expect(stack.bindings.Api.some((entry) => entry.sid === 'external-storage')).toBe(false)
    for (const id of ['LocalDatabase', 'LocalCache', 'LocalOAuth', 'LocalFiles']) {
      expect(stack.resources[id].Adopt).toBe(false)
      expect(stack.resources[id].RemovalPolicy).toBe('retain')
    }
  })

  it('preserves the production Worker names, domains, account and API entrypoint', () => {
    expect(deployment.accountId).toBe('5643a837ef66765e7881c0831a36ebed')
    expect(deployment.api.name).toBe('projektor')
    expect(deployment.frontend.name).toBe('projektor-frontend')
    expect(deployment.api.origin).toBe('https://projektor-api.totto2727.dev')
    expect(deployment.frontend.hostname).toBe('projektor.totto2727.dev')
    expect(deployment.api.main).toBe('./src/api/index.ts')
    expect(deployment.api.compatibility).toEqual({
      date: '2024-09-23',
      flags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
    })
    expect(deployment.api.crons).toEqual(['0 3 * * *'])
  })

  it('uses exact external storage bindings without declaring a storage lifecycle', () => {
    expect(existingStorageBindings()).toEqual([
      { type: 'd1', name: 'DB', databaseId: 'e852f9c2-e817-409e-bbf0-3168e82a1afc' },
      { type: 'kv_namespace', name: 'KV', namespaceId: 'b5598fbbbc2e48e3beab8bf9aecfc4bd' },
      { type: 'kv_namespace', name: 'OAUTH_KV', namespaceId: 'b187546f271142419343787032f6ca9b' },
      { type: 'r2_bucket', name: 'R2', bucketName: 'projektor-files' },
    ])
    const bindings = existingStorageBindings()
    bindings.pop()
    expect(existingStorageBindings()).toHaveLength(4)
  })

  it('retains the existing Access audience and does not enable production bypasses', async () => {
    const { api } = await registerApi(false, deployment.accountId, null, undefined, {
      DEV_USER_EMAIL: 'untrusted-dev@example.com',
    })
    const vars = api.Props.env
    expect(vars).toMatchObject({
      ENVIRONMENT: 'production',
      CF_ACCESS_TEAM_DOMAIN: 'totto2727.cloudflareaccess.com',
      CF_ACCESS_AUDIENCE: '327e65a1c53f85fa45155ffe4b7e1e8c35740cce3efc70b1f161392f5144ddb9',
      ADMIN_EMAILS: 'kaihatu.totto2727@gmail.com',
      AUTO_JOIN_ROLE: 'none',
    })
    for (const name of [
      'DEV_USER_EMAIL',
      'BOOTSTRAP_SECRET',
      'PUBLIC_READ_ONLY',
      'WORKSPACE_SUBDOMAIN_ROUTING',
      'JWT_SECRET',
    ]) {
      expect(vars).not.toHaveProperty(name)
    }
    expect(deployment.access.domain).toBe(deployment.frontend.hostname)
  })

  it('provides the identity bypass only through the local Layer', async () => {
    const local = await registerApi(true)
    expect(local.api.Props.env).toMatchObject({
      ENVIRONMENT: 'development',
      DEV_USER_EMAIL: localDevelopment.userEmail,
      ADMIN_EMAILS: localDevelopment.userEmail,
    })
    const customized = await registerApi(true, deployment.accountId, null, undefined, {
      DEV_USER_EMAIL: 'local@example.com',
    })
    expect(customized.api.Props.env).toMatchObject({
      DEV_USER_EMAIL: 'local@example.com',
    })
  })

  it('leaves an omitted production secret unchanged and accepts explicit initial configuration', async () => {
    const missing = await registerApi(false, deployment.accountId, null)
    expect(missing.api.Props.env).not.toHaveProperty('JWT_SECRET')
    const supplied = await registerApi(false)
    const preserved = supplied.api.Props.env?.JWT_SECRET
    if (!Redacted.isRedacted(preserved)) throw new Error('Expected the configured secret')
    expect(Redacted.value(preserved)).toBe('test-existing-production-value')
    expect(JSON.stringify(preserved)).not.toContain('test-existing-production-value')
  })

  it('uses the known development secret only locally, without production configuration', async () => {
    const { api } = await registerApi(true, deployment.accountId, null)
    const secret = api.Props.env?.JWT_SECRET
    if (!Redacted.isRedacted(secret)) throw new Error('Expected the development secret')
    expect(Redacted.value(secret)).toBe(localDevelopment.jwtSecret)
  })

  it('accepts an explicit aggregate LocalLayer without reading a production secret', async () => {
    // The injected Layer, not leaf-level ALCHEMY_DEV reads, determines both Workers' dependencies.
    const { api, frontend, stack } = await registerApi(false, deployment.accountId, null, LocalLayer)
    expect(api.Adopt).toBe(false)
    expect(api.Props.env).toMatchObject({
      ENVIRONMENT: 'development',
      DEV_USER_EMAIL: localDevelopment.userEmail,
    })
    expect(api.Props.env?.DB).toBe(stack.resources.LocalDatabase)
    expect(frontend.Props.env?.DB).toBe(stack.resources.LocalDatabase)
    expect(stack.bindings.Api.some((entry) => entry.sid === 'external-storage')).toBe(false)
  })

  it('accepts an explicit aggregate ProductionLayer without registering local resources', async () => {
    const { api, frontend, stack } = await registerApi(true, deployment.accountId, null, ProductionLayer)
    expect(api.Adopt).toBe(true)
    expect(api.Props.env).toMatchObject({ ENVIRONMENT: 'production' })
    expect(api.Props.env).not.toHaveProperty('DEV_USER_EMAIL')
    expect(frontend.Props.env).not.toHaveProperty('JWT_SECRET')
    expect(Object.keys(stack.resources).sort()).toEqual(['Api', 'Frontend'])
    const bindings = dedupeBindings(stack.bindings.Api).flatMap((entry) => entry.data.bindings ?? [])
    expect(bindings.filter((binding) => binding.name === 'JWT_SECRET')).toEqual([
      { type: 'inherit', name: 'JWT_SECRET' },
    ])
    expect(stack.bindings.Api.filter((entry) => entry.sid === 'existing-jwt-secret')).toHaveLength(1)
    expect(stack.bindings.Frontend.filter((entry) => entry.sid === 'external-database')).toHaveLength(1)
  })
})
