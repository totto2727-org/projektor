import { ALCHEMY_DEV, ALCHEMY_PHASE, RemovalPolicy } from 'alchemy'
import { AdoptPolicy, adopt } from 'alchemy/AdoptPolicy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { type Worker, type WorkerBinding, type WorkerBindingProps, type WorkerProps } from 'alchemy/Cloudflare/Workers'
import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'

import { apiOrigin } from './src/deployment'

/** Existing production identities. Storage and Access remain operator-owned. */
export const deployment = {
  accountId: '5643a837ef66765e7881c0831a36ebed',
  api: {
    name: 'projektor',
    hostname: 'projektor-api.totto2727.dev',
    origin: apiOrigin,
    main: './src/api/index.ts',
    compatibility: {
      date: '2024-09-23',
      flags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
    },
    crons: ['0 3 * * *'],
  },
  frontend: {
    name: 'projektor-frontend',
    hostname: 'projektor.totto2727.dev',
    origin: 'https://projektor.totto2727.dev',
  },
  storage: {
    database: { id: 'e852f9c2-e817-409e-bbf0-3168e82a1afc', name: 'projektor' },
    cache: { id: 'b5598fbbbc2e48e3beab8bf9aecfc4bd', title: 'projektor' },
    oauth: { id: 'b187546f271142419343787032f6ca9b', title: 'projektor-oauth' },
    files: { name: 'projektor-files' },
  },
  access: {
    teamDomain: 'totto2727.cloudflareaccess.com',
    audience: '327e65a1c53f85fa45155ffe4b7e1e8c35740cce3efc70b1f161392f5144ddb9',
    domain: 'projektor.totto2727.dev',
  },
}

export const localDevelopment = {
  userEmail: 'dev@projektor.local',
  jwtSecret: 'projektor-local-development-only-secret',
}

/** Public bindings grant access to existing IDs without declaring a storage lifecycle. */
export function existingStorageBindings(): WorkerBinding[] {
  return [
    { type: 'd1', name: 'DB', databaseId: deployment.storage.database.id },
    { type: 'kv_namespace', name: 'KV', namespaceId: deployment.storage.cache.id },
    { type: 'kv_namespace', name: 'OAUTH_KV', namespaceId: deployment.storage.oauth.id },
    { type: 'r2_bucket', name: 'R2', bucketName: deployment.storage.files.name },
  ]
}

const commonApplicationEnvironment = {
  CF_ACCESS_TEAM_DOMAIN: deployment.access.teamDomain,
  CF_ACCESS_AUDIENCE: deployment.access.audience,
  DEFAULT_WORKSPACE_SLUG: 'projektor',
  DEFAULT_WORKSPACE_NAME: 'Projektor',
  AUTO_JOIN_ROLE: 'none',
}

const commonApiEnvironment = {
  ...commonApplicationEnvironment,
  // Preserve the deployed name/class. WorkspaceHub stays unbound, no old migrations replay.
  RATE_LIMITER: Cloudflare.DurableObject('RateLimiter', { className: 'RateLimiter' }),
}

export const LocalDatabase = Cloudflare.D1.Database('LocalDatabase', {
  name: 'projektor-local',
  migrations: './migrations',
})

class DeploymentEnvironment extends Context.Service<
  DeploymentEnvironment,
  {
    readonly apiProps: Pick<WorkerProps, 'env'>
    readonly frontendEnv: WorkerBindingProps
    readonly bindApi: (api: Worker) => Effect.Effect<void>
    readonly bindFrontend: (frontend: Worker) => Effect.Effect<void>
  }
>()('projektor/DeploymentEnvironment') {}

/** All development inputs and native local resources belong to this one Layer. */
export const LocalLayer = Layer.mergeAll(
  Layer.succeed(AdoptPolicy, false),
  Layer.effect(
    DeploymentEnvironment,
    Effect.gen(function* () {
      const email = yield* Config.String('DEV_USER_EMAIL').pipe(
        Config.withDefault(localDevelopment.userEmail),
        Effect.orDie,
      )
      const db = yield* LocalDatabase
      const sharedEnvironment = {
        ...commonApplicationEnvironment,
        ENVIRONMENT: 'development',
        ADMIN_EMAILS: email,
        DEV_USER_EMAIL: email,
        DB: db,
        KV: yield* Cloudflare.KV.Namespace('LocalCache', { title: 'projektor-local' }),
        OAUTH_KV: yield* Cloudflare.KV.Namespace('LocalOAuth', { title: 'projektor-oauth-local' }),
        R2: yield* Cloudflare.R2.Bucket('LocalFiles', { name: 'projektor-files-local' }),
      }
      return {
        apiProps: {
          env: {
            ...commonApiEnvironment,
            ...sharedEnvironment,
            JWT_SECRET: Redacted.make(localDevelopment.jwtSecret),
          },
        },
        frontendEnv: sharedEnvironment,
        bindApi: () => Effect.void,
        bindFrontend: () => Effect.void,
      }
    }).pipe(adopt(false), RemovalPolicy.retain()),
  ),
)

/** Existing storage and optional initial secret input are production-only dependencies. */
export const ProductionLayer = Layer.mergeAll(
  Layer.succeed(AdoptPolicy, true),
  Layer.effect(
    DeploymentEnvironment,
    Effect.gen(function* () {
      const secret = yield* Config.Redacted('JWT_SECRET').pipe(Config.option, Effect.orDie)
      const secretEnv: WorkerBindingProps = Option.isSome(secret) ? { JWT_SECRET: secret.value } : {}
      const sharedEnvironment = {
        ...commonApplicationEnvironment,
        ENVIRONMENT: 'production',
        ADMIN_EMAILS: 'kaihatu.totto2727@gmail.com',
      }
      return {
        apiProps: {
          env: {
            ...commonApiEnvironment,
            ...sharedEnvironment,
            ...secretEnv,
          },
        },
        frontendEnv: sharedEnvironment,
        bindApi: (api: Worker) =>
          Effect.gen(function* () {
            yield* api.bind('external-storage', { bindings: existingStorageBindings() })
            if (Option.isNone(secret)) {
              yield* api.bind('existing-jwt-secret', {
                bindings: [{ type: 'inherit', name: 'JWT_SECRET' }],
              })
            }
          }),
        bindFrontend: (frontend: Worker) =>
          frontend.bind('external-storage', {
            bindings: existingStorageBindings(),
          }),
      }
    }),
  ),
)

// Worker capture must construct symbolic identities without secrets, profiles or storage.
const RuntimeLayer = Layer.mergeAll(
  Layer.succeed(AdoptPolicy, false),
  Layer.succeed(DeploymentEnvironment, {
    apiProps: {},
    frontendEnv: {},
    bindApi: () => Effect.void,
    bindFrontend: () => Effect.void,
  }),
)

/** Select the aggregate environment only at the composition boundary, never in Workers. */
export const DeploymentLayer = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* ALCHEMY_PHASE) === 'runtime') return RuntimeLayer
    return (yield* ALCHEMY_DEV) ? LocalLayer : ProductionLayer
  }),
)

const apiIdentity = {
  name: deployment.api.name,
  main: deployment.api.main,
  compatibility: deployment.api.compatibility,
  workersDev: { enabled: false, previewsEnabled: false },
  domain: { name: deployment.api.hostname, previews: false },
  crons: deployment.api.crons,
}

export const Api = Cloudflare.Worker(
  'Api',
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    return { ...apiIdentity, ...environment.apiProps }
  }),
).pipe(RemovalPolicy.retain())

class Frontend extends Cloudflare.Worker<Frontend>()(
  'Frontend',
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    const api = yield* Api
    return {
      name: deployment.frontend.name,
      main: import.meta.url,
      compatibility: { date: '2026-09-01', flags: ['nodejs_compat'] },
      workersDev: { enabled: false, previewsEnabled: false },
      domain: { name: deployment.frontend.hostname, previews: false },
      env: {
        ...environment.frontendEnv,
        // Reference the API-owned namespace, never host or migrate another RateLimiter.
        RATE_LIMITER: Cloudflare.DurableObject('RateLimiter', {
          className: 'RateLimiter',
          scriptName: api.workerName,
        }),
      },
      vite: { rootDir: '.', viteEnvironments: { entry: 'rsc', children: ['ssr'] } },
    }
  }),
  Effect.promise(() => import('./src/web/worker')).pipe(Effect.flatMap(({ makeWebWorker }) => makeWebWorker())),
) {}

const frontend = Frontend.pipe(
  adopt(true),
  RemovalPolicy.retain(),
  Effect.tap((frontend) =>
    Effect.gen(function* () {
      const environment = yield* DeploymentEnvironment
      yield* environment.bindFrontend(frontend)
    }),
  ),
)

export const WorkerResources = Effect.gen(function* () {
  const api = yield* Api
  const web = yield* frontend
  const environment = yield* DeploymentEnvironment
  // Wire the API once after both declarations. The frontend references only its RateLimiter namespace.
  yield* environment.bindApi(api)
  return { api, frontend: web }
})

export default frontend.pipe(Effect.provide(DeploymentLayer))
