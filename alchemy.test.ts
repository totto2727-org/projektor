import assert from 'node:assert/strict'

import { Credentials } from '@distilled.cloud/cloudflare/Credentials'
import { NodeServices } from '@effect/platform-node'
import { Stack } from 'alchemy'
import { AdoptPolicy } from 'alchemy/AdoptPolicy'
import { CloudflareEnvironment, Providers } from 'alchemy/Cloudflare'
import type { WorkerBindingProps } from 'alchemy/Cloudflare/Workers'
import { dedupeBindings, diffBindings } from 'alchemy/Diff'
import * as Output from 'alchemy/Output'
import { Iterable, Predicate, ConfigProvider, Effect, Redacted } from 'effect'
import { HttpClient } from 'effect/http'
import { describe, expect, test } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'

import { workers } from './alchemy.run'
import { WorkerResources } from './alchemy.ts'
import { LocalLayer, ProductionLayer, localDevelopment } from './worker-environment.ts'
import type { EnvironmentLayer } from './worker-environment.ts'
import { deployment } from './worker-graph.ts'
import CoreEntrypoint from './workers/core.ts'
import Frontend from './workers/frontend.ts'

const configured = function configured<A, E, R>(effect: Effect.Effect<A, E, R>, values: Record<string, string>) {
  return effect.pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values)))
}

const register = async function register(
  local: boolean,
  productionSecret: string | null = 'test-existing-production-value',
  environmentLayer?: EnvironmentLayer,
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
  const resources = await runTestEffect(
    configured(environmentLayer ? WorkerResources.pipe(Effect.provide(environmentLayer)) : workers, {
      ALCHEMY_DEV: local ? 'true' : 'false',
      ...(Predicate.isNullish(productionSecret) ? {} : { JWT_SECRET: productionSecret }),
      ...extraConfig,
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(Credentials, Effect.die(new Error('Registration resolved Cloudflare credentials'))),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die(new Error('Registration called a cloud API'))),
      ),
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

const bindings = function bindings(stack: Stack['Service'], id: string) {
  return dedupeBindings(stack.bindings[id] ?? []).flatMap((entry) => entry.data.bindings ?? [])
}

const storageNames = ['DB', 'KV', 'OAUTH_KV', 'R2']

const expectNoStorage = function expectNoStorage(stack: Stack['Service'], id: 'Api' | 'Frontend'): void {
  const resource = stack.resources[id]
  const deniedNames = id === 'Api' ? storageNames.filter((name) => name !== 'OAUTH_KV') : storageNames
  Iterable.forEach(deniedNames, (name) => {
    expect(resource.Props.env).not.toHaveProperty(name)
    expect(bindings(stack, id).some((binding) => binding.name === name)).toBe(false)
  })
  expect(
    bindings(stack, id).some(
      (binding) =>
        ['d1', 'kv_namespace', 'r2_bucket'].includes(binding.type) &&
        !(id === 'Api' && binding.type === 'kv_namespace' && binding.name === 'OAUTH_KV'),
    ),
  ).toBe(false)
}

describe('source-owned private Core deployment', () => {
  test.each([
    { id: 'Core', entrypoint: CoreEntrypoint },
    { id: 'Frontend', entrypoint: Frontend },
  ])('selects the $id default export from its configured production module', async ({ id, entrypoint }) => {
    const { stack } = await register(false)
    const main = stack.resources[id].Props.main
    assert.ok(main)
    const module: unknown = await import(main)
    expect(module).toHaveProperty('default', entrypoint)
  })

  test.each([
    { local: false, entrypoint: CoreEntrypoint.pipe(Effect.asVoid), ids: ['Core'] },
    { local: true, entrypoint: CoreEntrypoint.pipe(Effect.asVoid), ids: ['Core'] },
    { local: false, entrypoint: Frontend.pipe(Effect.asVoid), ids: ['Core', 'Frontend'] },
    { local: true, entrypoint: Frontend.pipe(Effect.asVoid), ids: ['Core', 'Frontend'] },
  ])('captures $ids without deployment inputs (dev=$local)', async ({ local, entrypoint, ids }) => {
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
      if (key === 'ALCHEMY_PHASE') {
        return Effect.succeed(ConfigProvider.makeValue('runtime'))
      }
      if (key === 'ALCHEMY_DEV') {
        return Effect.succeed(ConfigProvider.makeValue(String(local)))
      }
      return Effect.die(new Error(`Runtime read deployment input ${key}`))
    })
    await runTestEffect(
      entrypoint.pipe(
        Effect.provide(NodeServices.layer),
        Effect.provideService(Credentials, Effect.die(new Error('Registration resolved Cloudflare credentials'))),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die(new Error('Registration called a cloud API'))),
        ),
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
    expect(Object.keys(stack.resources).sort()).toEqual(ids)
    expect(stack.actions).toEqual({})
    expect(new Set(reads)).toEqual(new Set(['ALCHEMY_PHASE']))
    expect(stack.resources.Core.Props.env).not.toHaveProperty('DB')
    expect(bindings(stack, 'Core').some((binding) => binding.type === 'd1')).toBe(false)
    if (ids.includes('Frontend')) {
      expectNoStorage(stack, 'Frontend')
      expect(bindings(stack, 'Frontend')).toContainEqual(expect.objectContaining({ type: 'service', name: 'CORE' }))
      Iterable.forEach(['API', 'API_BASE', 'JWT_SECRET'], (name) => {
        expect(stack.resources.Frontend.Props.env).not.toHaveProperty(name)
      })
    }
  })

  test.each([false, true])('binds both public adapters natively to the same private Core (dev=%s)', async (local) => {
    const { core, api, frontend, stack } = await register(local)
    expect(core.RemovalPolicy).toBe('retain')
    expect(core.Props).toMatchObject({
      main: './workers/core.ts',
      name: 'projektor-core',
      workersDev: { enabled: false, previewsEnabled: false },
    })
    Iterable.forEach(['domain', 'routes', 'crons', 'migrations', 'access'], (property) => {
      expect(core.Props).not.toHaveProperty(property)
    })
    Iterable.forEach(
      [
        ['Api', api],
        ['Frontend', frontend],
      ] as const,
      ([id, adapter]) => {
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
      },
    )
    Iterable.forEach(['JWT_SECRET', 'API', 'API_BASE'], (name) => {
      expect(frontend.Props.env).not.toHaveProperty(name)
    })
    expect(core.Props.env).not.toHaveProperty('JWT_SECRET')
  })

  test('uses native D1 migrations without custom Actions and directly gates every Worker update', async () => {
    const { stack } = await register(false)
    expect(stack.actions).toEqual({})
    expect(stack.resources.Database.Props).toEqual({ migrations: './migrations', name: 'projektor' })
    Iterable.forEach(['Core', 'Api', 'Frontend'], (id) => {
      const environment = stack.resources[id].Props.env?.ENVIRONMENT
      expect(Output.isOutput(environment)).toBe(true)
      expect(environment.kind).toBe('ApplyExpr')
      expect(environment.expr.identifier).toBe('migrationsHashes')
      expect(environment.expr.expr.src.LogicalId).toBe('Database')
    })
    const local = await register(true)
    expect(local.stack.actions).toEqual({})
  })

  test('grants business storage only to Core and shares only official OAuth protocol KV with API', async () => {
    const { core, api, stack } = await register(false)
    expect(Object.keys(stack.resources).sort()).toEqual([
      'Api',
      'Cache',
      'Core',
      'Database',
      'Files',
      'Frontend',
      'OAuth',
    ])
    expect(core.Adopt).toBe(true)
    Iterable.forEach(
      [
        ['DB', 'Database'],
        ['KV', 'Cache'],
        ['OAUTH_KV', 'OAuth'],
        ['R2', 'Files'],
      ],
      ([name, id]) => {
        expect((core.Props.env as WorkerBindingProps)[name]).toBe(stack.resources[id])
        expect(stack.resources[id].Adopt).toBe(true)
        expect(stack.resources[id].RemovalPolicy).toBe('retain')
      },
    )
    expect((api.Props.env as WorkerBindingProps).OAUTH_KV).toBe(stack.resources.OAuth)
    expect(stack.resources.Cache.Props).toEqual({ title: 'projektor' })
    expect(stack.resources.OAuth.Props).toEqual({ title: 'projektor-oauth' })
    expect(stack.resources.Files.Props).toEqual({
      lifecycleRules: [
        {
          abortMultipartUploadsTransition: { condition: { maxAge: 604_800, type: 'Age' } },
          id: 'Default Multipart Abort Rule',
        },
      ],
      name: 'projektor-files',
      publicAccess: false,
    })
    expectNoStorage(stack, 'Api')
    expectNoStorage(stack, 'Frontend')
  })

  test('declares retained local storage once, only on Core, with local migrations', async () => {
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
    expect(stack.resources.LocalDatabase.Props).toMatchObject({ migrations: './migrations', name: 'projektor-local' })
    Iterable.forEach(
      [
        ['DB', 'LocalDatabase'],
        ['KV', 'LocalCache'],
        ['OAUTH_KV', 'LocalOAuth'],
        ['R2', 'LocalFiles'],
      ],
      ([name, id]) => {
        expect((core.Props.env as WorkerBindingProps)[name]).toBe(stack.resources[id])
        expect(stack.resources[id].Adopt).toBe(false)
        expect(stack.resources[id].RemovalPolicy).toBe('retain')
        if (name === 'OAUTH_KV') {
          expect((api.Props.env as WorkerBindingProps)[name]).toBe(stack.resources.LocalOAuth)
        } else {
          expect(api.Props.env).not.toHaveProperty(name)
        }
        expect(frontend.Props.env).not.toHaveProperty(name)
      },
    )
    expect(api.Adopt).toBe(false)
    expect(core.Adopt).toBe(false)
    expect(bindings(stack, 'Core').some((binding) => binding.type === 'd1')).toBe(true)
  })

  test.each([false, true])('keeps the API-owned RateLimiter namespace and sole cron (dev=%s)', async (local) => {
    const { api, stack } = await register(local)
    expect(api.Props.crons).toEqual(['0 3 * * *'])
    Iterable.forEach(['Api', 'Core', 'Frontend'], (id) => {
      const namespaces = bindings(stack, id).filter((binding) => binding.type === 'durable_object_namespace')
      expect(namespaces).toHaveLength(1)
      expect(namespaces[0]).toMatchObject({ className: 'RateLimiter', name: 'RATE_LIMITER' })
      expect(namespaces[0].scriptName).toBe(id === 'Api' ? undefined : deployment.api.name)
      expect(namespaces[0].transferredFrom).toBeUndefined()
      expect(namespaces[0]).not.toHaveProperty('namespaceId')
      expect(bindings(stack, id).some((binding) => binding.className === 'WorkspaceHub')).toBe(false)
      if (id !== 'Api') {
        expect(stack.resources[id].Props).not.toHaveProperty('crons')
      }
    })
  })

  test('preserves exact public identities, compatibility, adoption and external Access policies', async () => {
    const { api, frontend } = await register(false)
    expect(api.Props).toMatchObject({
      compatibility: {
        date: '2024-09-23',
        flags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
      },
      domain: { name: 'projektor-api.totto2727.dev', previews: false },
      main: './src/api/worker.ts',
      name: 'projektor',
      workersDev: { enabled: false, previewsEnabled: false },
    })
    expect(frontend.Props).toMatchObject({
      domain: { name: 'projektor.totto2727.dev', previews: false },
      main: './workers/frontend.ts',
      name: 'projektor-frontend',
      vite: { rootDir: '.', viteEnvironments: { children: ['ssr'], entry: 'rsc' } },
      workersDev: { enabled: false, previewsEnabled: false },
    })
    Iterable.forEach([api, frontend], (resource) => {
      expect(resource.RemovalPolicy).toBe('retain')
      expect(resource.Adopt).toBe(true)
      expect(resource.Props).not.toHaveProperty('access')
    })
    expect(deployment.accountId).toBe('5643a837ef66765e7881c0831a36ebed')
    expect(deployment.api.origin).toBe('https://projektor-api.totto2727.dev')
    expect(deployment.frontend.origin).toBe('https://projektor.totto2727.dev')
    expect(deployment.access.domain).toBe(deployment.frontend.hostname)
  })

  test('inherits the existing API signing secret without granting it to Core or Web', async () => {
    const { api, core, frontend, stack } = await register(false, null)
    Iterable.forEach([api, core, frontend], (resource) => {
      expect(resource.Props.env).not.toHaveProperty('JWT_SECRET')
    })
    expect(bindings(stack, 'Api').filter((binding) => binding.name === 'JWT_SECRET')).toEqual([
      { name: 'JWT_SECRET', type: 'inherit' },
    ])
    Iterable.forEach(['Core', 'Frontend'], (id) => {
      expect(bindings(stack, id).some((binding) => binding.name === 'JWT_SECRET')).toBe(false)
    })
  })

  test('accepts explicit initial API secret configuration then transitions to stable inheritance', async () => {
    const initial = await register(false)
    const secret = (initial.api.Props.env as WorkerBindingProps).JWT_SECRET
    if (!Redacted.isRedacted(secret)) {
      throw new Error('Expected configured redacted secret')
    }
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
    ).toEqual([{ name: 'JWT_SECRET', type: 'inherit' }])
    expect(changes.some((entry) => entry.action === 'delete')).toBe(true)
    const inheritedSecretBindings = inherited.stack.bindings.Api.filter((entry) => entry.sid === 'existing-jwt-secret')
    const repeatedSecretBindings = repeated.stack.bindings.Api.filter((entry) => entry.sid === 'existing-jwt-secret')
    expect(
      diffBindings(inheritedSecretBindings, repeatedSecretBindings).every((entry) => entry.action === 'noop'),
    ).toBe(true)
  })

  test('uses development bypass/secret only in the local aggregate Layer', async () => {
    const local = await register(true, null, undefined, { DEV_USER_EMAIL: 'local@example.com' })
    Iterable.forEach([local.api, local.core, local.frontend], (resource) => {
      expect(resource.Props.env).toMatchObject({
        ADMIN_EMAILS: 'local@example.com',
        DEV_USER_EMAIL: 'local@example.com',
        ENVIRONMENT: 'development',
      })
    })
    const secret = (local.api.Props.env as WorkerBindingProps).JWT_SECRET
    if (!Redacted.isRedacted(secret)) {
      throw new Error('Expected local redacted secret')
    }
    expect(Redacted.value(secret)).toBe(localDevelopment.jwtSecret)
    const production = await register(false, null, undefined, { DEV_USER_EMAIL: 'untrusted@example.com' })
    Iterable.forEach([production.api, production.core, production.frontend], (resource) => {
      expect(resource.Props.env).toMatchObject({
        ENVIRONMENT: expect.objectContaining({ kind: 'ApplyExpr' }),
        AUTO_JOIN_ROLE: 'none',
        CF_ACCESS_TEAM_DOMAIN: deployment.access.teamDomain,
        CF_ACCESS_AUDIENCE: deployment.access.audience,
      })
      Iterable.forEach(
        ['DEV_USER_EMAIL', 'BOOTSTRAP_SECRET', 'PUBLIC_READ_ONLY', 'WORKSPACE_SUBDOMAIN_ROUTING'],
        (name) => {
          expect(resource.Props.env).not.toHaveProperty(name)
        },
      )
    })
  })

  test('selects explicit aggregate Layers without leaf-level environment branching', async () => {
    const local = await register(false, null, LocalLayer)
    expect((local.core.Props.env as WorkerBindingProps).DB).toBe(local.stack.resources.LocalDatabase)
    expect(local.api.Props.env).toMatchObject({
      ENVIRONMENT: 'development',
      DEV_USER_EMAIL: localDevelopment.userEmail,
    })
    const production = await register(true, null, ProductionLayer)
    expect(Object.keys(production.stack.resources).sort()).toEqual([
      'Api',
      'Cache',
      'Core',
      'Database',
      'Files',
      'Frontend',
      'OAuth',
    ])
    expect(production.api.Adopt).toBe(true)
    expect(production.core.Props.env).toMatchObject({
      ENVIRONMENT: expect.objectContaining({ kind: 'ApplyExpr' }),
    })
    expect((production.core.Props.env as WorkerBindingProps).DB).toBe(production.stack.resources.Database)
    expectNoStorage(production.stack, 'Api')
    expectNoStorage(production.stack, 'Frontend')
  })

  test('does not add custom account-selection gates', async () => {
    const { stack } = await register(false, null, undefined, {}, 'different-account')
    expect(Object.keys(stack.resources).sort()).toEqual([
      'Api',
      'Cache',
      'Core',
      'Database',
      'Files',
      'Frontend',
      'OAuth',
    ])
  })
})
