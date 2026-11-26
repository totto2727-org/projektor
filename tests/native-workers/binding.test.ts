import { env as nativeApiEnv } from 'cloudflare:workers'
import { Iterable, Predicate } from 'effect'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { describe, expect, test } from 'vite-plus/test'

import { RateLimitResult } from '#contracts/request-rate-limit.ts'
import { runTestEffect, runInOrder } from '#tests/run-effect.ts'

import type NativeFixtureCore from './core.worker'

interface FixtureBinding {
  fixtureEnvironment(): Promise<ReturnType<NativeFixtureCore['fixtureEnvironment']>>
  fixtureSession(settings: Readonly<Record<string, string | null>>): Promise<FixtureBinding>
}

const fixtureBinding = function fixtureBinding(value: unknown): FixtureBinding {
  if (
    !Predicate.isObjectKeyword(value) ||
    Predicate.isFunction(value) ||
    !Predicate.isFunction(Reflect.get(value, 'fixtureEnvironment')) ||
    !Predicate.isFunction(Reflect.get(value, 'fixtureSession'))
  ) {
    throw new Error('The actual native Core fixture binding is missing')
  }
  return value as FixtureBinding
}

const core = fixtureBinding(Reflect.get(nativeApiEnv, 'CORE'))

describe('actual native API and Core topology', () => {
  test('does not give the public API database, cache or file capabilities', () => {
    expect.hasAssertions()
    Iterable.forEach(['DB', 'KV', 'R2'], (name) => {
      expect(name in nativeApiEnv).toBe(false)
    })
  })

  test('keeps real native storage in the private Core isolate', async () => {
    await expect(core.fixtureEnvironment()).resolves.toMatchObject({ cache: true, database: true, files: true })
  })

  test('dispatches the official named Core RPC protocol through root and configured session bindings', async () => {
    expect.hasAssertions()
    const session = await core.fixtureSession({ DEV_USER_EMAIL: '' })
    await runInOrder([core, session], async (binding): Promise<void> => {
      const wire = await runTestEffect(makeCoreClient(binding).apiCheckRateLimit({}))
      expect(wire).toSatisfy(Predicate.isString)
      expect(JSON.parse(wire)).toHaveProperty('_tag')
      const decoded = await runTestEffect(
        decodeCoreReply(RateLimitResult, makeCoreClient(binding).apiCheckRateLimit({})),
      )
      expect(decoded).toBeNull()
    })
  })

  test('applies each session policy inside actual named Core handlers, not only fixture inspection', async () => {
    const epoch = `native-session-policy-${crypto.randomUUID()}`
    const [restricted, ordinary] = await Promise.all([
      core.fixtureSession({
        RATE_LIMIT_TEST_EPOCH: epoch,
        RATE_LIMIT_TEST_NOW_MS: '1700000000000',
        RATE_LIMIT_AUTH_MAX: '1',
      }),
      core.fixtureSession({
        RATE_LIMIT_TEST_EPOCH: epoch,
        RATE_LIMIT_TEST_NOW_MS: '1700000000000',
        RATE_LIMIT_AUTH_MAX: '10',
      }),
    ])
    const check = (binding: FixtureBinding) =>
      runTestEffect(
        decodeCoreReply(RateLimitResult, makeCoreClient(binding).apiCheckRateLimit({ ip: '203.0.113.254' })),
      )
    await expect(check(restricted)).resolves.toBeNull()
    await expect(check(restricted)).resolves.toMatchObject({ retryAfter: expect.any(Number) })
    await expect(check(ordinary)).resolves.toBeNull()
  })

  test('creates independently configured native Core sessions without shared policy state', async () => {
    const [first, second] = await Promise.all([
      core.fixtureSession({ DEV_USER_EMAIL: 'first@example.test', BRAND_NAME: 'First' }),
      core.fixtureSession({ DEV_USER_EMAIL: 'second@example.test', BRAND_NAME: 'Second' }),
    ])
    const [firstPolicy, secondPolicy, rootPolicy] = await Promise.all([
      first.fixtureEnvironment(),
      second.fixtureEnvironment(),
      core.fixtureEnvironment(),
    ])
    expect(firstPolicy).toMatchObject({ brandName: 'First', devEmail: 'first@example.test' })
    expect(secondPolicy).toMatchObject({ brandName: 'Second', devEmail: 'second@example.test' })
    expect(rootPolicy).toMatchObject({ brandName: null, devEmail: '' })
  })
})
