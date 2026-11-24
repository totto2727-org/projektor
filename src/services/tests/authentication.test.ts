import { Buffer } from 'node:buffer'

import { Predicate, Effect } from 'effect'
import { Hono } from 'hono'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { authMiddleware } from '#api/middleware/auth.ts'
import { resetProvisioningCacheForTests } from '#commands/provisioning.ts'
import { makeApiIdentityHandlers } from '#core/api/identity-operations.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import {
  authenticateBrowser,
  BrowserAuthenticationError,
  resetAuthCachesForTests,
  verifyJwtPayload,
} from '#services/authentication.ts'
import type { BrowserAuthEnvironment } from '#services/authentication.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import type { ApiEnv, HonoEnv } from '#types'
import { createTestResources } from '@/server/test/resources.ts'
import { createTestDatabase } from '@/test/database.ts'

const issuer = 'https://team.example.test'
const audience = 'browser-audience'
let pair: CryptoKeyPair
let otherPair: CryptoKeyPair
let key: JsonWebKey
let otherKey: JsonWebKey
beforeAll(async () => {
  const algorithm = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }
  pair = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
  otherPair = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
  key = await crypto.subtle.exportKey('jwk', pair.publicKey)
  otherKey = await crypto.subtle.exportKey('jwk', otherPair.publicKey)
})
const token = async function token(
  overrides: Record<string, unknown> = {},
  signingPair = pair,
  algorithm = 'RS256',
): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: algorithm })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: [audience],
      iss: issuer,
      email: 'person@example.test',
      ...overrides,
    }),
  ).toString('base64url')
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    signingPair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`
}
const browser = function browser(jwt: string, cookie = false) {
  return new Request('https://front.example.test/issues', {
    headers: cookie
      ? { cookie: `unrelated=private; CF_Authorization=${jwt}; other=value` }
      : { 'cf-access-jwt-assertion': jwt },
  })
}
describe('shared browser authentication without API transport or signing secrets', () => {
  let database: ReturnType<typeof createTestDatabase>
  let env: BrowserAuthEnvironment
  let cache: Map<string, string>
  let externalFetch: ReturnType<typeof vi.fn<typeof fetch>>
  beforeEach(() => {
    resetAuthCachesForTests()
    resetProvisioningCacheForTests()
    database = createTestDatabase()
    database.sqlite.exec("INSERT INTO workspaces(id,name,slug,created_at) VALUES ('workspace-a','Alpha','alpha',1)")
    cache = new Map([['cf-access-certs', JSON.stringify([key])]])
    env = {
      DB: database.db,
      KV: {
        get: async (name: string, type?: string) => {
          const value = cache.get(name)
          return Predicate.isNullish(value) ? null : type === 'json' ? JSON.parse(value) : value
        },
        put: async (name: string, value: string) => {
          cache.set(name, value)
        },
      } as unknown as KVNamespace,
      ENVIRONMENT: 'production',
      CF_ACCESS_TEAM_DOMAIN: 'team.example.test',
      CF_ACCESS_AUDIENCE: audience,
      DEFAULT_WORKSPACE_SLUG: 'alpha',
      AUTO_JOIN_ROLE: 'member',
    }
    externalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ keys: [key] }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    database.close()
  })
  const api = function api(
    request: Request,
    settings: BrowserAuthEnvironment & { PUBLIC_READ_ONLY?: string } = env,
  ): Response | Promise<Response> {
    /*
     * The API sees only a native-style RPC binding. Its method runs the real Core
     * handler and returns the application's wire reply through the public SDK.
     */
    const coreEnv: CoreEnvironment = { ...createTestResources(), ...settings }
    const handlers = makeApiIdentityHandlers(Effect.succeed(coreEnv))
    const CORE = {
      apiAuthenticate: (...args: Parameters<typeof handlers.apiAuthenticate>) =>
        runTestEffect(handlers.apiAuthenticate(...args)),
    }
    const apiEnv = { CORE } as unknown as ApiEnv
    expect(apiEnv).not.toHaveProperty('DB')
    expect(apiEnv).not.toHaveProperty('KV')
    const application = new Hono<HonoEnv>()
    application.use('*', authMiddleware)
    application.get('*', (context) => context.json({ user: context.get('user'), auth: context.get('auth') }))
    return application.fetch(request, apiEnv, {
      props: {},
      waitUntil: () => {},
      passThroughOnException: () => {},
    })
  }

  test.each([false, true])(
    'verifies a real signed Access %s credential and provisions its current identity',
    async (cookie) => {
      const principal = await authenticateBrowser(browser(await token(), cookie), env)
      expect(principal).toMatchObject({
        auth: { kind: 'human', method: 'access' },
        user: { email: 'person@example.test', name: 'person' },
      })
      expect(
        database.sqlite
          .prepare('SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?')
          .get(principal.user.id, 'workspace-a'),
      ).toEqual({ role: 'member' })
      expect(env).not.toHaveProperty('JWT_SECRET')
      expect(JSON.stringify(principal)).not.toContain('CF_Authorization')
      expect(externalFetch).not.toHaveBeenCalled()
    },
  )

  test('verifies signed claims directly through the shared verifier', async () => {
    await expect(verifyJwtPayload(await token(), [key], audience, issuer)).resolves.toEqual({
      email: 'person@example.test',
    })
    await expect(verifyJwtPayload(await token({}, otherPair), [key], audience, issuer)).resolves.toBeNull()
    await expect(
      verifyJwtPayload(await token({ aud: ['wrong-audience'] }), [key], audience, issuer),
    ).resolves.toBeNull()
  })

  test('preserves exact API Access success and invalid-token response contracts', async () => {
    const allowed = await api(browser(await token(), true))
    expect(allowed.status).toBe(200)
    await expect(allowed.json()).resolves.toMatchObject({
      auth: { kind: 'human', method: 'access' },
      user: { email: 'person@example.test' },
    })
    const denied = await api(browser('invalid'))
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toStrictEqual({ error: 'Invalid Access token' })
    expect(denied.headers.get('set-cookie')).toBeNull()
  })

  test('preserves API 503 when Access JWKS is unavailable instead of a login verdict', async () => {
    cache.delete('cf-access-certs')
    externalFetch.mockRejectedValue(new Error('offline'))
    const denied = await api(browser(await token()))
    expect(denied.status).toBe(503)
    await expect(denied.json()).resolves.toStrictEqual({ error: 'Authentication temporarily unavailable' })
  })

  test('keeps the API dev bypass disabled for MCP while preserving its browser strategy', async () => {
    env.ENVIRONMENT = 'development'
    env.DEV_USER_EMAIL = 'dev@example.test'
    const result = await api(new Request('https://api.example.test/auth/me'))
    expect(result.status).toBe(200)
    const denied = await api(new Request('https://api.example.test/mcp/workspace-a'))
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toContain('Bearer')
  })

  test('preserves the API-only opt-in public viewer fallback and invalid-credential precedence', async () => {
    const settings = { ...env, PUBLIC_READ_ONLY: 'true' }
    const allowed = await api(new Request('https://api.example.test/auth/me'), settings)
    expect(allowed.status).toBe(200)
    await expect(allowed.json()).resolves.toMatchObject({
      auth: { kind: 'human', method: 'public' },
      user: { email: 'public-viewer@projektor.local' },
    })
    const denied = await api(browser('invalid'), settings)
    expect(denied.status).toBe(401)
    await expect(denied.json()).resolves.toStrictEqual({ error: 'Invalid Access token' })
  })

  test.each([
    { exp: 1 },
    { exp: undefined },
    { aud: ['wrong-audience'] },
    { aud: undefined },
    { iss: 'https://wrong.example.test' },
    { iss: undefined },
    { email: undefined },
    { email: '' },
  ])('rejects invalid or expired signed claims %j without DB or JWKS IO', async (claims) => {
    const prepare = vi.spyOn(database.db, 'prepare')
    await expect(authenticateBrowser(browser(await token(claims)), env)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid Access token',
    })
    expect(prepare).not.toHaveBeenCalled()
    expect(externalFetch).not.toHaveBeenCalled()
  })

  test('rejects an unsupported signing algorithm before JWKS IO', async () => {
    await expect(authenticateBrowser(browser(await token({}, pair, 'HS256')), env)).rejects.toMatchObject({
      status: 401,
    })
    expect(externalFetch).not.toHaveBeenCalled()
  })

  test('rejects malformed and incorrectly signed credentials without provisioning', async () => {
    const prepare = vi.spyOn(database.db, 'prepare')
    await expect(authenticateBrowser(browser('not-a-jwt'), env)).rejects.toMatchObject({ status: 401 })
    await expect(authenticateBrowser(browser(await token({}, otherPair)), env)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid Access token',
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  test('gives a header precedence over a cookie and never falls back to dev after invalid Access', async () => {
    env.ENVIRONMENT = 'development'
    env.DEV_USER_EMAIL = 'dev@example.test'
    await expect(
      authenticateBrowser(
        new Request('https://front.example.test/', {
          headers: {
            'cf-access-jwt-assertion': 'invalid',
            cookie: `CF_Authorization=${await token()}`,
          },
        }),
        env,
      ),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid Access token' })
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 })
  })

  test.each(['network', 'status', 'schema'])(
    'distinguishes JWKS %s unavailability from an invalid credential',
    async (failure) => {
      cache.delete('cf-access-certs')
      const prepare = vi.spyOn(database.db, 'prepare')
      if (failure === 'network') {
        externalFetch.mockRejectedValue(new Error('offline'))
      } else if (failure === 'status') {
        externalFetch.mockResolvedValue(new Response('Unavailable', { status: 503 }))
      } else {
        externalFetch.mockResolvedValue(Response.json({ malformed: true }))
      }
      await expect(authenticateBrowser(browser(await token()), env)).rejects.toMatchObject({
        status: 503,
        message: 'Authentication temporarily unavailable',
      })
      expect(prepare).not.toHaveBeenCalled()
      const input = externalFetch.mock.calls[0]?.[0]
      expect(input instanceof Request ? input.url : String(input)).toBe(`${issuer}/cdn-cgi/access/certs`)
    },
  )

  test('refreshes a rotated signing key once and verifies against the real replacement', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
    externalFetch.mockResolvedValue(Response.json({ keys: [otherKey] }))
    await expect(authenticateBrowser(browser(await token({}, otherPair)), env)).resolves.toMatchObject({
      auth: { kind: 'human', method: 'access' },
    })
    expect(externalFetch).toHaveBeenCalledOnce()
    expect(JSON.parse(cache.get('cf-access-certs') ?? '[]')).toMatchObject([otherKey])
  })

  test('uses the dev identity only in explicit development and never in production', async () => {
    env.DEV_USER_EMAIL = 'dev@example.test'
    const request = new Request('https://front.example.test/')
    await expect(authenticateBrowser(request, env)).rejects.toEqual(new BrowserAuthenticationError(401, 'Unauthorized'))
    expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 0 })
    env.ENVIRONMENT = 'development'
    await expect(authenticateBrowser(request, env)).resolves.toMatchObject({
      auth: { kind: 'human', method: 'dev' },
      user: { email: 'dev@example.test' },
    })
    expect(externalFetch).not.toHaveBeenCalled()
  })
})
