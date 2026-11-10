import { Stack } from 'alchemy'
import { AdoptPolicy } from 'alchemy/AdoptPolicy'
import { CloudflareEnvironment, Providers } from 'alchemy/Cloudflare'
import type { WorkerBindingProps } from 'alchemy/Cloudflare/Workers'
import { dedupeBindings, diffBindings } from 'alchemy/Diff'
import * as Output from 'alchemy/Output'
import { ConfigProvider, Effect, Redacted } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import Frontend, {
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

async function register(
  local: boolean,
  productionSecret: string | null = 'test-existing-production-value',
  environmentLayer?: typeof LocalLayer | typeof ProductionLayer,
  extraConfig: Record<string, string> = {},
  accountId = deployment.accountId,
) {
  const stack: Stack['Service'] = {
    name: 'projektor',
    stage: local ? 'dev' : 'production',
    resources: {},
    bindings: {},
    actions: {},
  }
  const resources = await Effect.runPromise(
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
      // Registration must not resolve providers, credentials or cloud APIs.
      Effect.provideService(Providers, { kind: 'ProviderCollection', providers: {}, get: () => undefined }),
    ),
  )
  return { ...resources, stack }
}

function bindings(stack: Stack['Service'], id: string) {
  return dedupeBindings(stack.bindings[id] ?? []).flatMap((entry) => entry.data.bindings ?? [])
}

const storageNames = ['DB', 'KV', 'OAUTH_KV', 'R2']

function expectNoStorage(stack: Stack['Service'], id: 'Api' | 'Frontend') {
  const resource = stack.resources[id]
  const deniedNames = id === 'Api' ? storageNames.filter((name) => name !== 'OAUTH_KV') : storageNames
  for (const name of deniedNames) {
    expect(resource.Props.env).not.toHaveProperty(name)
    expect(bindings(stack, id).some((binding) => binding.name === name)).toBe(false)
  }
  expect(
    bindings(stack, id).some(
      (binding) =>
        ['d1', 'kv_namespace', 'r2_bucket'].includes(binding.type) &&
        !(id === 'Api' && binding.type === 'kv_namespace' && binding.name === 'OAUTH_KV'),
    ),
  ).toBe(false)
}

describe('source-owned private Core deployment', () => {
  it.each([false, true])('captures the private graph without deployment inputs (dev=%s)', async (local) => {
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
    expect(Object.keys(stack.resources).sort()).toEqual(['Core', 'Frontend'])
    expect(new Set(reads)).toEqual(new Set(['ALCHEMY_PHASE']))
    expect(stack.resources.Core.Props.env).not.toHaveProperty('DB')
    expect(bindings(stack, 'Core').some((binding) => binding.type === 'd1')).toBe(false)
    expectNoStorage(stack, 'Frontend')
    expect(bindings(stack, 'Frontend')).toContainEqual(expect.objectContaining({ type: 'service', name: 'CORE' }))
    for (const name of ['API', 'API_BASE', 'JWT_SECRET'])
      expect(stack.resources.Frontend.Props.env).not.toHaveProperty(name)
  })

  it.each([false, true])('binds both public adapters natively to the same private Core (dev=%s)', async (local) => {
    const { core, api, frontend, stack } = await register(local)
    expect(core.RemovalPolicy).toBe('retain')
    expect(core.Props).toMatchObject({
      name: 'projektor-core',
      main: new URL('./alchemy.ts', import.meta.url).href,
      workersDev: { enabled: false, previewsEnabled: false },
    })
    for (const property of ['domain', 'routes', 'crons', 'migrations', 'access'])
      expect(core.Props).not.toHaveProperty(property)
    for (const [id, adapter] of [
      ['Api', api],
      ['Frontend', frontend],
    ] as const) {
      expectNoStorage(stack, id)
      expect(adapter.Props.env?.CORE).toBe(core)
      const services = bindings(stack, id).filter((binding) => binding.type === 'service')
      expect(services).toHaveLength(1)
      expect(services[0].name).toBe('CORE')
      expect(Output.isOutput(services[0].service)).toBe(true)
      expect(services[0].service.kind).toBe('PropExpr')
      expect(services[0].service.identifier).toBe('workerName')
      expect(services[0].service.expr.src.LogicalId).toBe('Core')
      expect(adapter.Props).not.toHaveProperty('migrations')
    }
    for (const name of ['JWT_SECRET', 'API', 'API_BASE']) expect(frontend.Props.env).not.toHaveProperty(name)
    expect(core.Props.env).not.toHaveProperty('JWT_SECRET')
  })

  it('grants business storage only to Core and shares only official OAuth protocol KV with API', async () => {
    const { core, stack } = await register(false)
    expect(Object.keys(stack.resources).sort()).toEqual(['Api', 'Core', 'Frontend'])
    expect(core.Adopt).toBe(true)
    const storage = bindings(stack, 'Core').filter((binding) =>
      ['d1', 'kv_namespace', 'r2_bucket'].includes(binding.type),
    )
    expect(storage).toEqual(existingStorageBindings())
    expect(bindings(stack, 'Api').filter((binding) => binding.type === 'kv_namespace')).toEqual([
      { type: 'kv_namespace', name: 'OAUTH_KV', namespaceId: 'b187546f271142419343787032f6ca9b' },
    ])
    expectNoStorage(stack, 'Api')
    expectNoStorage(stack, 'Frontend')
    expect(existingStorageBindings()).toEqual([
      { type: 'd1', name: 'DB', databaseId: 'e852f9c2-e817-409e-bbf0-3168e82a1afc' },
      { type: 'kv_namespace', name: 'KV', namespaceId: 'b5598fbbbc2e48e3beab8bf9aecfc4bd' },
      { type: 'kv_namespace', name: 'OAUTH_KV', namespaceId: 'b187546f271142419343787032f6ca9b' },
      { type: 'r2_bucket', name: 'R2', bucketName: 'projektor-files' },
    ])
    const copy = existingStorageBindings()
    copy.pop()
    expect(existingStorageBindings()).toHaveLength(4)
  })

  it('declares retained local storage once, only on Core, with local migrations', async () => {
    const { core, api, frontend, stack } = await register(true)
    expect(Object.keys(stack.resources).sort()).toEqual([
      'Api',
      'Core',
      'Frontend',
      'LocalCache',
      'LocalDatabase',
      'LocalFiles',
      'LocalOAuth',
    ])
    expect(stack.resources.LocalDatabase.Props).toMatchObject({ name: 'projektor-local', migrations: './migrations' })
    for (const [name, id] of [
      ['DB', 'LocalDatabase'],
      ['KV', 'LocalCache'],
      ['OAUTH_KV', 'LocalOAuth'],
      ['R2', 'LocalFiles'],
    ]) {
      expect((core.Props.env as WorkerBindingProps)[name]).toBe(stack.resources[id])
      expect(stack.resources[id].Adopt).toBe(false)
      expect(stack.resources[id].RemovalPolicy).toBe('retain')
      if (name === 'OAUTH_KV') expect((api.Props.env as WorkerBindingProps)[name]).toBe(stack.resources.LocalOAuth)
      else expect(api.Props.env).not.toHaveProperty(name)
      expect(frontend.Props.env).not.toHaveProperty(name)
    }
    expect(api.Adopt).toBe(false)
    expect(core.Adopt).toBe(false)
    expect(bindings(stack, 'Core').some((binding) => binding.type === 'd1')).toBe(true)
  })

  it.each([false, true])('keeps the API-owned RateLimiter namespace and sole cron (dev=%s)', async (local) => {
    const { api, stack } = await register(local)
    expect(api.Props.crons).toEqual(['0 3 * * *'])
    for (const id of ['Api', 'Core', 'Frontend']) {
      const namespaces = bindings(stack, id).filter((binding) => binding.type === 'durable_object_namespace')
      expect(namespaces).toHaveLength(1)
      expect(namespaces[0]).toMatchObject({ name: 'RATE_LIMITER', className: 'RateLimiter' })
      expect(namespaces[0].scriptName).toBe(id === 'Api' ? undefined : deployment.api.name)
      expect(namespaces[0].transferredFrom).toBeUndefined()
      expect(namespaces[0]).not.toHaveProperty('namespaceId')
      expect(bindings(stack, id).some((binding) => binding.className === 'WorkspaceHub')).toBe(false)
      if (id !== 'Api') expect(stack.resources[id].Props).not.toHaveProperty('crons')
    }
  })

  it('preserves exact public identities, compatibility, adoption and external Access policies', async () => {
    const { api, frontend } = await register(false)
    expect(api.Props).toMatchObject({
      name: 'projektor',
      main: './src/api/index.ts',
      domain: { name: 'projektor-api.totto2727.dev', previews: false },
      workersDev: { enabled: false, previewsEnabled: false },
      compatibility: {
        date: '2024-09-23',
        flags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
      },
    })
    expect(frontend.Props).toMatchObject({
      name: 'projektor-frontend',
      domain: { name: 'projektor.totto2727.dev', previews: false },
      workersDev: { enabled: false, previewsEnabled: false },
      vite: { rootDir: '.', viteEnvironments: { entry: 'rsc', children: ['ssr'] } },
    })
    expect(frontend.Props.main).toMatch(/\/alchemy\.ts$/)
    for (const resource of [api, frontend]) {
      expect(resource.RemovalPolicy).toBe('retain')
      expect(resource.Adopt).toBe(true)
      expect(resource.Props).not.toHaveProperty('access')
    }
    expect(deployment.accountId).toBe('5643a837ef66765e7881c0831a36ebed')
    expect(deployment.api.origin).toBe('https://projektor-api.totto2727.dev')
    expect(deployment.frontend.origin).toBe('https://projektor.totto2727.dev')
    expect(deployment.access.domain).toBe(deployment.frontend.hostname)
  })

  it('inherits the existing API signing secret without granting it to Core or Web', async () => {
    const { api, core, frontend, stack } = await register(false, null)
    for (const resource of [api, core, frontend]) expect(resource.Props.env).not.toHaveProperty('JWT_SECRET')
    expect(bindings(stack, 'Api').filter((binding) => binding.name === 'JWT_SECRET')).toEqual([
      { type: 'inherit', name: 'JWT_SECRET' },
    ])
    for (const id of ['Core', 'Frontend'])
      expect(bindings(stack, id).some((binding) => binding.name === 'JWT_SECRET')).toBe(false)
  })

  it('accepts explicit initial API secret configuration then transitions to stable inheritance', async () => {
    const initial = await register(false)
    const secret = (initial.api.Props.env as WorkerBindingProps).JWT_SECRET
    if (!Redacted.isRedacted(secret)) throw new Error('Expected configured redacted secret')
    expect(Redacted.value(secret)).toBe('test-existing-production-value')
    expect(JSON.stringify(secret)).not.toContain('test-existing-production-value')
    const inherited = await register(false, null)
    const repeated = await register(false, null)
    const changes = diffBindings(initial.stack.bindings.Api, inherited.stack.bindings.Api)
    expect(
      changes
        .filter((entry) => entry.action !== 'delete')
        .flatMap((entry) => entry.data.bindings ?? [])
        .filter((binding) => binding.name === 'JWT_SECRET'),
    ).toEqual([{ type: 'inherit', name: 'JWT_SECRET' }])
    expect(changes.some((entry) => entry.action === 'delete')).toBe(true)
    const inheritedSecretBindings = inherited.stack.bindings.Api.filter((entry) => entry.sid === 'existing-jwt-secret')
    const repeatedSecretBindings = repeated.stack.bindings.Api.filter((entry) => entry.sid === 'existing-jwt-secret')
    expect(
      diffBindings(inheritedSecretBindings, repeatedSecretBindings).every((entry) => entry.action === 'noop'),
    ).toBe(true)
  })

  it('uses development bypass/secret only in the local aggregate Layer', async () => {
    const local = await register(true, null, undefined, { DEV_USER_EMAIL: 'local@example.com' })
    for (const resource of [local.api, local.core, local.frontend])
      expect(resource.Props.env).toMatchObject({
        ENVIRONMENT: 'development',
        DEV_USER_EMAIL: 'local@example.com',
        ADMIN_EMAILS: 'local@example.com',
      })
    const secret = (local.api.Props.env as WorkerBindingProps).JWT_SECRET
    if (!Redacted.isRedacted(secret)) throw new Error('Expected local redacted secret')
    expect(Redacted.value(secret)).toBe(localDevelopment.jwtSecret)
    const production = await register(false, null, undefined, { DEV_USER_EMAIL: 'untrusted@example.com' })
    for (const resource of [production.api, production.core, production.frontend]) {
      expect(resource.Props.env).toMatchObject({
        ENVIRONMENT: 'production',
        AUTO_JOIN_ROLE: 'none',
        CF_ACCESS_TEAM_DOMAIN: deployment.access.teamDomain,
        CF_ACCESS_AUDIENCE: deployment.access.audience,
      })
      for (const name of ['DEV_USER_EMAIL', 'BOOTSTRAP_SECRET', 'PUBLIC_READ_ONLY', 'WORKSPACE_SUBDOMAIN_ROUTING'])
        expect(resource.Props.env).not.toHaveProperty(name)
    }
  })

  it('selects explicit aggregate Layers without leaf-level environment branching', async () => {
    const local = await register(false, null, LocalLayer)
    expect((local.core.Props.env as WorkerBindingProps).DB).toBe(local.stack.resources.LocalDatabase)
    expect(local.api.Props.env).toMatchObject({
      ENVIRONMENT: 'development',
      DEV_USER_EMAIL: localDevelopment.userEmail,
    })
    const production = await register(true, null, ProductionLayer)
    expect(Object.keys(production.stack.resources).sort()).toEqual(['Api', 'Core', 'Frontend'])
    expect(production.api.Adopt).toBe(true)
    expect(production.core.Props.env).toMatchObject({ ENVIRONMENT: 'production' })
    expect(bindings(production.stack, 'Core')).toEqual(expect.arrayContaining(existingStorageBindings()))
    expectNoStorage(production.stack, 'Api')
    expectNoStorage(production.stack, 'Frontend')
  })

  it('does not add custom account-selection gates', async () => {
    const { stack } = await register(false, null, undefined, {}, 'different-account')
    expect(Object.keys(stack.resources).sort()).toEqual(['Api', 'Core', 'Frontend'])
  })
})
