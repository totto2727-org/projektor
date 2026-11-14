import type { ExecutionContext } from '@cloudflare/workers-types'
import api from 'virtual:production-api-entrypoint'

import type FixtureCore from './core.worker'

// Preserve the real API's hosted namespace and scheduled forwarding.
export { RateLimiter, WorkspaceHub } from 'virtual:production-api-entrypoint'

let ready: Promise<{ migrations: number }> | undefined

type FixtureApiEnv = Parameters<typeof api.fetch>[1] & {
  CORE: Pick<FixtureCore, 'initializeFixture' | 'reinitializeFixture'>
}

export default {
  async fetch(request: Request, env: FixtureApiEnv, context: ExecutionContext) {
    // The adapter only invokes Core RPC. It has no DB binding, even for fixtures.
    ready ??= env.CORE.initializeFixture().catch((error: unknown) => {
      ready = undefined
      throw error
    })
    await ready
    if (new URL(request.url).pathname === '/_fixture/reinitialize' && request.method === 'POST') {
      return Response.json(await env.CORE.reinitializeFixture())
    }
    return api.fetch(request, env, context)
  },
  scheduled: api.scheduled,
}
