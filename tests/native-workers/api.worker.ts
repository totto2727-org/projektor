import api from '../../src/api/index'
import type { FixtureConfiguration } from './core.worker'

export { RateLimiter, WorkspaceHub } from '../../src/api/index'

type ApiEnvironment = Parameters<typeof api.fetch>[1]
type FixtureEnvironment = ApiEnvironment & {
  readonly CORE_FIXTURE_CONFIGURATION?: string
  readonly CORE: ApiEnvironment['CORE'] & {
    fixtureSession(settings: FixtureConfiguration): Promise<ApiEnvironment['CORE']>
  }
}

function configuration(value: string | undefined): FixtureConfiguration {
  const parsed: unknown = value === undefined ? {} : JSON.parse(value)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid native API fixture policy')
  }
  const settings: Record<string, string | null> = {}
  for (const [key, item] of Object.entries(parsed)) {
    if (item !== null && typeof item !== 'string') throw new Error(`Invalid fixture policy: ${key}`)
    settings[key] = item
  }
  return settings
}

/** Native RPC stubs are owned by their invocation. Construct the configured
 * Core session inside the actual API request, never in the Vitest driver's
 * earlier setup context. This wrapper has no storage or production export. */
async function requestEnvironment(env: FixtureEnvironment): Promise<ApiEnvironment> {
  const core = await env.CORE.fixtureSession(configuration(env.CORE_FIXTURE_CONFIGURATION))
  return { ...env, CORE: core }
}

export default {
  async fetch(request: Request, env: FixtureEnvironment, context: ExecutionContext): Promise<Response> {
    return api.fetch(request, await requestEnvironment(env), context)
  },
  async scheduled(controller: ScheduledController, env: FixtureEnvironment, context: ExecutionContext): Promise<void> {
    return api.scheduled(controller, await requestEnvironment(env), context)
  },
} satisfies ExportedHandler<FixtureEnvironment>
