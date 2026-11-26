import { Iterable, Predicate } from 'effect'

import api from '#api/worker.ts'

import type { FixtureConfiguration } from './core.worker'

export { RateLimiter, WorkspaceHub } from '#api/worker.ts'

type ApiEnvironment = Parameters<typeof api.fetch>[1]
type FixtureEnvironment = ApiEnvironment &
  Readonly<{
    CORE_FIXTURE_CONFIGURATION?: string
    CORE: ApiEnvironment['CORE'] & {
      fixtureSession(settings: FixtureConfiguration): Promise<ApiEnvironment['CORE']>
    }
  }>

const configuration = function configuration(value: string | undefined): FixtureConfiguration {
  const parsed: unknown = Predicate.isNullish(value) ? {} : JSON.parse(value)
  if (!Predicate.isObject(parsed)) {
    throw new Error('Invalid native API fixture policy')
  }
  const settings: Record<string, string | null> = {}
  Iterable.forEach(Object.entries(parsed), ([key, item]) => {
    if (item !== null && !Predicate.isString(item)) {
      throw new Error(`Invalid fixture policy: ${key}`)
    }
    settings[key] = item
  })
  return settings
}

/**
 * Native RPC stubs are owned by their invocation. Construct the configured
 * Core session inside the actual API request, never in the Vitest driver's
 * earlier setup context. This wrapper has no storage or production export.
 *
 * @param {FixtureEnvironment} env The fixture bindings for the current native API request.
 * @returns {Promise<ApiEnvironment>} The API environment configured with the request-local Core session.
 */
const requestEnvironment = async function requestEnvironment(env: FixtureEnvironment): Promise<ApiEnvironment> {
  const core = await env.CORE.fixtureSession(configuration(env.CORE_FIXTURE_CONFIGURATION))
  return { ...env, CORE: core }
}

// oxlint-disable-next-line import/no-default-export -- Workerd loads the native test API fetch handler from the default export.
export default {
  async fetch(request: Request, env: FixtureEnvironment, context: ExecutionContext): Promise<Response> {
    return api.fetch(request, await requestEnvironment(env), context)
  },
  async scheduled(controller: ScheduledController, env: FixtureEnvironment, context: ExecutionContext): Promise<void> {
    return api.scheduled(controller, await requestEnvironment(env), context)
  },
} satisfies ExportedHandler<FixtureEnvironment>
