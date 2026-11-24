import { ALCHEMY_DEV, ALCHEMY_PHASE, RemovalPolicy } from 'alchemy'
import { AdoptPolicy, adopt } from 'alchemy/AdoptPolicy'
import * as Cloudflare from 'alchemy/Cloudflare'
import type { Worker, WorkerBindingProps } from 'alchemy/Cloudflare/Workers'
import * as Output from 'alchemy/Output'
import { Config, Context, Effect, Layer, Option, Redacted } from 'effect'

import { deployment } from './worker-graph.ts'

export const localDevelopment = {
  userEmail: 'dev@projektor.local',
  jwtSecret: 'projektor-local-development-only-secret',
}

const commonApplicationEnvironment = {
  CF_ACCESS_TEAM_DOMAIN: deployment.access.teamDomain,
  CF_ACCESS_AUDIENCE: deployment.access.audience,
  DEFAULT_WORKSPACE_SLUG: 'projektor',
  DEFAULT_WORKSPACE_NAME: 'Projektor',
  AUTO_JOIN_ROLE: 'none',
}

export const rateLimiterReference = (): Cloudflare.DurableObjectLike<unknown> =>
  Cloudflare.DurableObject('RateLimiter', {
    className: 'RateLimiter',
    // Preserve the deployed namespace without a Core -> Api -> Core resource cycle.
    scriptName: deployment.api.name,
  })

export const LocalDatabase = Cloudflare.D1.Database('LocalDatabase', {
  name: 'projektor-local',
  migrations: './migrations',
})

export class DeploymentEnvironment extends Context.Service<
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

/** Adopt existing physical storage and use the same native migration provider as development. */
export const ProductionLayer = Layer.mergeAll(
  Layer.succeed(AdoptPolicy, true),
  Layer.effect(
    DeploymentEnvironment,
    Effect.gen(function* () {
      const database = yield* Cloudflare.D1.Database('Database', {
        name: deployment.storage.database.name,
        migrations: './migrations',
      })
      const oauth = yield* Cloudflare.KV.Namespace('OAuth', { title: deployment.storage.oauth.title })
      const secret = yield* Config.Redacted('JWT_SECRET').pipe(Config.option, Effect.orDie)
      const secretEnv: WorkerBindingProps = Option.isSome(secret) ? { JWT_SECRET: secret.value } : {}
      const sharedEnvironment = {
        ...commonApplicationEnvironment,
        // databaseId is stable and resolves before migrations. This nonstable output
        // gates every Worker on completed D1 reconciliation, even with unchanged Core.
        ENVIRONMENT: Output.map(database.migrationsHashes, () => 'production'),
        ADMIN_EMAILS: 'kaihatu.totto2727@gmail.com',
      }
      return {
        apiEnv: { ...sharedEnvironment, ...secretEnv, OAUTH_KV: oauth },
        frontendEnv: sharedEnvironment,
        coreEnv: {
          ...sharedEnvironment,
          DB: database,
          KV: yield* Cloudflare.KV.Namespace('Cache', { title: deployment.storage.cache.title }),
          OAUTH_KV: oauth,
          R2: yield* Cloudflare.R2.Bucket('Files', {
            name: deployment.storage.files.name,
            publicAccess: false,
            // Preserve the existing Cloudflare rule during adoption rather than clearing it.
            lifecycleRules: [
              {
                id: 'Default Multipart Abort Rule',
                abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 604_800 } },
              },
            ],
          }),
        },
        bindApi: (api: Worker) =>
          Effect.gen(function* () {
            if (Option.isNone(secret)) {
              yield* api.bind('existing-jwt-secret', { bindings: [{ type: 'inherit', name: 'JWT_SECRET' }] })
            }
          }),
        bindCore: () => Effect.void,
      }
    }).pipe(adopt(true), RemovalPolicy.retain()),
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

type EnvironmentLayers = typeof LocalLayer | typeof RuntimeLayer
export type EnvironmentLayer = Layer.Layer<
  Layer.Success<EnvironmentLayers>,
  Layer.Error<EnvironmentLayers>,
  Layer.Services<EnvironmentLayers>
>

export const DeploymentLayer = Layer.unwrap(
  Effect.gen(function* () {
    const layer: EnvironmentLayer =
      (yield* ALCHEMY_PHASE) === 'runtime' ? RuntimeLayer : (yield* ALCHEMY_DEV) ? LocalLayer : ProductionLayer
    return layer
  }),
)
