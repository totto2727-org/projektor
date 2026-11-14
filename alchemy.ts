import { ALCHEMY_DEV, ALCHEMY_PHASE, RemovalPolicy } from 'alchemy'
import { AdoptPolicy, adopt } from 'alchemy/AdoptPolicy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { type Worker, type WorkerBinding, type WorkerBindingProps } from 'alchemy/Cloudflare/Workers'
import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'

import { Core as CoreIdentity } from './src/workers/identities'
import { deployment } from './worker-graph'

export { deployment } from './worker-graph'

export const localDevelopment = {
  userEmail: 'dev@projektor.local',
  jwtSecret: 'projektor-local-development-only-secret',
}

/** Core owns business storage. The OAuth adapter also receives its dedicated protocol KV. */
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

const rateLimiterReference = () =>
  Cloudflare.DurableObject('RateLimiter', {
    className: 'RateLimiter',
    // Preserve the deployed namespace without a Core -> Api -> Core resource cycle.
    scriptName: deployment.api.name,
  })

export const LocalDatabase = Cloudflare.D1.Database('LocalDatabase', {
  name: 'projektor-local',
  migrations: './migrations',
})

class DeploymentEnvironment extends Context.Service<
  DeploymentEnvironment,
  {
    readonly apiEnv: WorkerBindingProps
    readonly frontendEnv: WorkerBindingProps
    readonly coreEnv: WorkerBindingProps
    readonly bindApi: (api: Worker) => Effect.Effect<void>
    readonly bindCore: (core: Worker) => Effect.Effect<void>
  }
>()('projektor/DeploymentEnvironment') {}

/** Development storage is registered once, with only protocol OAuth KV shared with API. */
export const LocalLayer = Layer.mergeAll(
  Layer.succeed(AdoptPolicy, false),
  Layer.effect(
    DeploymentEnvironment,
    Effect.gen(function* () {
      const email = yield* Config.String('DEV_USER_EMAIL').pipe(
        Config.withDefault(localDevelopment.userEmail),
        Effect.orDie,
      )
      const sharedEnvironment = {
        ...commonApplicationEnvironment,
        ENVIRONMENT: 'development',
        ADMIN_EMAILS: email,
        DEV_USER_EMAIL: email,
      }
      const oauth = yield* Cloudflare.KV.Namespace('LocalOAuth', { title: 'projektor-oauth-local' })
      return {
        apiEnv: { ...sharedEnvironment, OAUTH_KV: oauth, JWT_SECRET: Redacted.make(localDevelopment.jwtSecret) },
        frontendEnv: sharedEnvironment,
        coreEnv: {
          ...sharedEnvironment,
          DB: yield* LocalDatabase,
          KV: yield* Cloudflare.KV.Namespace('LocalCache', { title: 'projektor-local' }),
          OAUTH_KV: oauth,
          R2: yield* Cloudflare.R2.Bucket('LocalFiles', { name: 'projektor-files-local' }),
        },
        bindApi: () => Effect.void,
        bindCore: () => Effect.void,
      }
    }).pipe(adopt(false), RemovalPolicy.retain()),
  ),
)

/** Existing storage and optional initial API signing secret are production-only inputs. */
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
        apiEnv: { ...sharedEnvironment, ...secretEnv },
        frontendEnv: sharedEnvironment,
        coreEnv: sharedEnvironment,
        bindApi: (api: Worker) =>
          Effect.gen(function* () {
            yield* api.bind('oauth-protocol-storage', {
              bindings: [{ type: 'kv_namespace', name: 'OAUTH_KV', namespaceId: deployment.storage.oauth.id }],
            })
            if (Option.isNone(secret)) {
              yield* api.bind('existing-jwt-secret', { bindings: [{ type: 'inherit', name: 'JWT_SECRET' }] })
            }
          }),
        bindCore: (core: Worker) => core.bind('external-storage', { bindings: existingStorageBindings() }),
      }
    }),
  ),
)

// Runtime capture constructs symbolic identities without secrets, profiles or local storage.
const RuntimeLayer = Layer.mergeAll(
  Layer.succeed(AdoptPolicy, false),
  Layer.succeed(DeploymentEnvironment, {
    apiEnv: {},
    frontendEnv: {},
    coreEnv: {},
    bindApi: () => Effect.void,
    bindCore: () => Effect.void,
  }),
)

export const DeploymentLayer = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* ALCHEMY_PHASE) === 'runtime') return RuntimeLayer
    return (yield* ALCHEMY_DEV) ? LocalLayer : ProductionLayer
  }),
)

const CoreLive = CoreIdentity.make(
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    return {
      name: deployment.core.name,
      main: deployment.core.main,
      compatibility: deployment.core.compatibility,
      workersDev: { enabled: false, previewsEnabled: false },
      env: { ...environment.coreEnv, RATE_LIMITER: rateLimiterReference() },
    }
  }),
  Effect.promise(() => import('./src/core/worker')).pipe(Effect.flatMap(({ makeCoreHandlers }) => makeCoreHandlers)),
)

export const Core = CoreIdentity.pipe(
  Effect.provide(CoreLive),
  RemovalPolicy.retain(),
  Effect.tap((core) =>
    Effect.gen(function* () {
      const environment = yield* DeploymentEnvironment
      yield* environment.bindCore(core)
    }),
  ),
)

export const Api = Cloudflare.Worker(
  'Api',
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    return {
      name: deployment.api.name,
      main: deployment.api.main,
      compatibility: deployment.api.compatibility,
      workersDev: { enabled: false, previewsEnabled: false },
      domain: { name: deployment.api.hostname, previews: false },
      crons: deployment.api.crons,
      env: {
        ...environment.apiEnv,
        CORE: yield* Core,
        // Keep the existing namespace hosted on its original physical Worker.
        RATE_LIMITER: Cloudflare.DurableObject('RateLimiter', { className: 'RateLimiter' }),
      },
    }
  }),
).pipe(RemovalPolicy.retain())

class Frontend extends Cloudflare.Worker<Frontend>()(
  'Frontend',
  Effect.gen(function* () {
    const environment = yield* DeploymentEnvironment
    return {
      name: deployment.frontend.name,
      main: import.meta.url,
      compatibility: deployment.frontend.compatibility,
      workersDev: { enabled: false, previewsEnabled: false },
      domain: { name: deployment.frontend.hostname, previews: false },
      env: { ...environment.frontendEnv, CORE: yield* Core, RATE_LIMITER: rateLimiterReference() },
      vite: { rootDir: '.', viteEnvironments: { entry: 'rsc', children: ['ssr'] } },
    }
  }),
  Effect.promise(() => import('./src/web/worker')).pipe(Effect.flatMap(({ makeWebWorker }) => makeWebWorker())),
) {}

const frontend = Frontend.pipe(adopt(true), RemovalPolicy.retain())

export const WorkerResources = Effect.gen(function* () {
  const core = yield* Core
  const api = yield* Api
  const web = yield* frontend
  const environment = yield* DeploymentEnvironment
  yield* environment.bindApi(api)
  return { core, api, frontend: web }
})

export default frontend.pipe(Effect.provide(DeploymentLayer))
