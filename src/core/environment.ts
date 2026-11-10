import { WorkerEnvironment, WorkerExecutionContext } from 'alchemy/Cloudflare/Workers'
import { Effect } from 'effect'

import type { CoreEnv } from '../types/env'

/** Persistent resources belong to Core. OAuth signing stays in the API adapter. */
export type CoreEnvironment = Omit<CoreEnv, 'JWT_SECRET' | 'ASSETS'> & {
  /** Local-only lifecycle capability, created by the Worker and never serialized. */
  readonly invocation?: { readonly waitUntil: (promise: Promise<unknown>) => void }
}

export type CoreEnvironmentSource = Effect.Effect<CoreEnvironment, never, WorkerEnvironment | WorkerExecutionContext>

/** A stable Effect description, resolved anew inside each native invocation. */
export const coreEnvironment: CoreEnvironmentSource = Effect.gen(function* () {
  const env = yield* WorkerEnvironment
  const context = yield* WorkerExecutionContext
  return {
    ...env,
    invocation: { waitUntil: (promise: Promise<unknown>) => context.raw.waitUntil(promise) },
  } as CoreEnvironment
})
