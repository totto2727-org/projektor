import { env as nativeApiEnv } from 'cloudflare:test'
import { describe, expect, it } from 'vite-plus/test'

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
