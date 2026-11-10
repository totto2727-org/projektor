import { env as nativeApiEnv } from 'cloudflare:test'
import { Effect } from 'effect'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { describe, expect, it } from 'vite-plus/test'

import { RateLimitResult } from '../../src/contracts/request-rate-limit'
import type NativeFixtureCore from './core.worker'

interface FixtureBinding {
  fixtureEnvironment(): Promise<ReturnType<NativeFixtureCore['fixtureEnvironment']>>
  fixtureSession(settings: Readonly<Record<string, string | null>>): Promise<FixtureBinding>
}

function fixtureBinding(value: unknown): FixtureBinding {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof Reflect.get(value, 'fixtureEnvironment') !== 'function' ||
    typeof Reflect.get(value, 'fixtureSession') !== 'function'
  ) {
    throw new Error('The actual native Core fixture binding is missing')
  }
  return value as FixtureBinding
}

const core = fixtureBinding(Reflect.get(nativeApiEnv, 'CORE'))

describe('actual native API and Core topology', () => {
  it('does not give the public API database, cache or file capabilities', () => {
    for (const name of ['DB', 'KV', 'R2']) expect(name in nativeApiEnv).toBe(false)
  })

  it('keeps real native storage in the private Core isolate', async () => {
    expect(await core.fixtureEnvironment()).toMatchObject({ database: true, cache: true, files: true })
  })

  it('dispatches the official named Core RPC protocol through root and configured session bindings', async () => {
    const session = await core.fixtureSession({ DEV_USER_EMAIL: '' })
    for (const binding of [core, session]) {
      const wire = await Effect.runPromise(makeCoreClient(binding).apiCheckRateLimit({}))
      expect(typeof wire).toBe('string')
      expect(JSON.parse(wire)).toHaveProperty('_tag')
      const decoded = await Effect.runPromise(
        decodeCoreReply(RateLimitResult, makeCoreClient(binding).apiCheckRateLimit({})),
      )
      expect(decoded).toBe(null)
    }
  })

  it('applies each session policy inside actual named Core handlers, not only fixture inspection', async () => {
    const epoch = `native-session-policy-${crypto.randomUUID()}`
    const [restricted, ordinary] = await Promise.all([
      core.fixtureSession({ RATE_LIMIT_TEST_EPOCH: epoch, RATE_LIMIT_AUTH_MAX: '1' }),
      core.fixtureSession({ RATE_LIMIT_TEST_EPOCH: epoch, RATE_LIMIT_AUTH_MAX: '10' }),
    ])
    const check = (binding: FixtureBinding) =>
      Effect.runPromise(
        decodeCoreReply(RateLimitResult, makeCoreClient(binding).apiCheckRateLimit({ ip: '203.0.113.254' })),
      )
    expect(await check(restricted)).toBe(null)
    expect(await check(restricted)).toMatchObject({ retryAfter: expect.any(Number) })
    expect(await check(ordinary)).toBe(null)
  })

  it('creates independently configured native Core sessions without shared policy state', async () => {
    const [first, second] = await Promise.all([
      core.fixtureSession({ DEV_USER_EMAIL: 'first@example.test', BRAND_NAME: 'First' }),
      core.fixtureSession({ DEV_USER_EMAIL: 'second@example.test', BRAND_NAME: 'Second' }),
    ])
    const [firstPolicy, secondPolicy, rootPolicy] = await Promise.all([
      first.fixtureEnvironment(),
      second.fixtureEnvironment(),
      core.fixtureEnvironment(),
    ])
    expect(firstPolicy).toMatchObject({ devEmail: 'first@example.test', brandName: 'First' })
    expect(secondPolicy).toMatchObject({ devEmail: 'second@example.test', brandName: 'Second' })
    expect(rootPolicy).toMatchObject({ devEmail: '', brandName: null })
  })
})
