import { Cause, Effect, Exit, Redacted } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '#commands/errors'
import { updateWorkspace } from '#commands/workspaces'
import { resetAuthCachesForTests } from '#services/authentication'
import type { AuthInfo } from '#types'

import { type Env, makeRequestServices, RequestServices } from '../request'
import { createTestDatabase } from '../test/database'
import { commandContext, commandError, runCommand } from './command-context'
import { ApiError, ScopeError } from './errors'
import { type FunctionContext, resolveFunctionContext } from './function-context'
import { testEnvironment } from './test/resources'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  resetAuthCachesForTests()
  for (const database of databases.splice(0)) database.close()
})
function fixture(overrides: Partial<Env> = {}, headers: HeadersInit = {}) {
  resetAuthCachesForTests()
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users(id,email,name,created_at) VALUES ('u','owner@example.test','Owner',1);
    INSERT INTO workspaces(id,name,slug,created_at) VALUES ('w','Before','alpha',1), ('other','Other','beta',1);
    INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES ('w','u','owner',1);
  `)
  const env = testEnvironment(database.db, 'owner@example.test', overrides)
  const request = new Request('https://front.example.test/_effront/mutation', {
    method: 'POST',
    headers: { origin: 'https://front.example.test', ...Object.fromEntries(new Headers(headers)) },
  })
  function run<A, E>(operation: Effect.Effect<A, E, RequestServices>) {
    return Effect.runPromise(
      makeRequestServices(request, env).pipe(
        Effect.flatMap((services) => operation.pipe(Effect.provideService(RequestServices, services))),
      ),
    )
  }
  return { database, env, run }
}
const context = resolveFunctionContext({ workspaceSlug: 'alpha' }, { requireWorkspace: true })

async function signedAccess(email: string) {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const input = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ email, aud: 'test-audience', iss: 'https://team.example.test', exp: Math.floor(Date.now() / 1000) + 300 })}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(input))
  return { token: `${input}.${Buffer.from(signature).toString('base64url')}`, jwk: { ...jwk, kid: 'test-key' } }
}

describe('native shared command capabilities', () => {
  it('executes an actual database command using the verified development identity and workspace', async () => {
    const { run, env, database } = fixture()
    const capability = await run(context.pipe(Effect.flatMap(commandContext)))
    expect(capability).toMatchObject({
      workspaceId: 'w',
      userId: 'u',
      role: 'owner',
      authKind: 'human',
      auth: { kind: 'human', method: 'dev' },
    })
    expect(capability.db).toBe(env.DB)
    expect(capability.kv).toBe(env.KV)
    expect(capability.r2).toBe(env.R2)
    expect(
      await run(
        context.pipe(
          Effect.flatMap((current) => runCommand(current, (ctx) => updateWorkspace(ctx, { name: 'After' }))),
        ),
      ),
    ).toEqual({ ok: true })
    expect(database.sqlite.prepare('SELECT name FROM workspaces WHERE id = ?').get('w')).toEqual({ name: 'After' })
    expect(database.sqlite.prepare('SELECT name FROM workspaces WHERE id = ?').get('other')).toEqual({ name: 'Other' })
  })

  it('accepts a cryptographically verified Access browser identity without development fallback', async () => {
    const signed = await signedAccess('owner@example.test')
    const { run, env } = fixture(
      { ENVIRONMENT: 'production', CF_ACCESS_TEAM_DOMAIN: 'team.example.test', CF_ACCESS_AUDIENCE: 'test-audience' },
      { 'Cf-Access-Jwt-Assertion': signed.token },
    )
    await env.KV.put('cf-access-certs', JSON.stringify([signed.jwk]))
    const capability = await run(context.pipe(Effect.flatMap(commandContext)))
    expect(capability.auth).toEqual({ kind: 'human', method: 'access' })
    expect(capability.userId).toBe('u')
    expect(capability.workspaceId).toBe('w')
  })

  it.each([
    ['missing credentials', { ENVIRONMENT: 'production' }, {}, 401],
    ['workspace token', {}, { authorization: 'Bearer pk_test' }, 403],
    ['invalid Access token', {}, { 'Cf-Access-Jwt-Assertion': 'invalid-token' }, 401],
    ['public viewer', { DEV_USER_EMAIL: 'public-viewer@projektor.local' }, {}, 403],
  ] satisfies readonly (readonly [string, Partial<Env>, HeadersInit, number])[])(
    'rejects %s before any command executes',
    async (_label, overrides, headers, status) => {
      const { run, database } = fixture(overrides, headers)
      await expect(
        run(
          context.pipe(
            Effect.flatMap((current) => runCommand(current, (ctx) => updateWorkspace(ctx, { name: 'Forbidden' }))),
          ),
        ),
      ).rejects.toMatchObject({ status })
      expect(database.sqlite.prepare('SELECT name FROM workspaces WHERE id = ?').get('w')).toEqual({ name: 'Before' })
    },
  )

  it.each([
    undefined,
    { kind: 'agent', method: 'pk' },
    { kind: 'human', method: 'public' },
    { kind: 'human', method: 'oauth' },
    { kind: 'agent', method: 'access' },
  ] satisfies readonly (AuthInfo | undefined)[])('rejects noninteractive command provenance %o', async (auth) => {
    const { run } = fixture()
    await expect(
      run(context.pipe(Effect.flatMap((current) => commandContext({ ...current, scope: { ...current.scope, auth } })))),
    ).rejects.toMatchObject({ _tag: 'ScopeError', status: 403 })
  })

  it('rejects a mismatched or missing selected workspace capability', async () => {
    const { run } = fixture()
    const cases = [
      (current: FunctionContext): FunctionContext => ({ ...current, workspaceSlug: 'beta' }),
      (current: FunctionContext): FunctionContext => ({ ...current, scope: { ...current.scope, workspaces: [] } }),
      (current: FunctionContext): FunctionContext => ({
        ...current,
        scope: { ...current.scope, selection: { kind: 'global' } },
      }),
    ]
    for (const change of cases) {
      await expect(
        run(context.pipe(Effect.flatMap((current) => commandContext(change(current))))),
      ).rejects.toMatchObject({ _tag: 'ScopeError', status: 403 })
    }
  })

  it('preserves actual command validation and role authorization failures', async () => {
    const { run, database } = fixture()
    await expect(
      run(context.pipe(Effect.flatMap((current) => runCommand(current, (ctx) => updateWorkspace(ctx, {}))))),
    ).rejects.toMatchObject({ _tag: 'ApiError', status: 400, message: 'Validation failed' })
    database.sqlite.exec("UPDATE workspace_members SET role = 'viewer'")
    await expect(
      run(
        context.pipe(
          Effect.flatMap((current) => runCommand(current, (ctx) => updateWorkspace(ctx, { name: 'Denied' }))),
        ),
      ),
    ).rejects.toMatchObject({ _tag: 'ScopeError', status: 403 })
  })

  it('does not turn Effect interruption or defects into domain errors', async () => {
    const { run } = fixture()
    const defect = await run(
      context.pipe(
        Effect.flatMap(() => Effect.die('defect')),
        Effect.exit,
      ),
    )
    const interrupted = await run(
      context.pipe(
        Effect.flatMap(() => Effect.interrupt),
        Effect.exit,
      ),
    )
    expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true)
    expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true)
  })
})

describe('safe native command error shaping', () => {
  it.each([
    [new ValidationError({ formErrors: ['private validation detail'], fieldErrors: {} }), 400, 'Validation failed'],
    [new NotFoundError('Missing', { headings: ['Title'] }), 404, 'Missing'],
    [new ForbiddenError('Denied'), 403, 'Denied'],
    [new ConflictError('Conflict', { currentRevisionId: 'revision' }), 409, 'Conflict'],
    [new PayloadTooLargeError(), 413, 'Payload too large'],
    [new UnsupportedMediaTypeError(), 415, 'Unsupported media type'],
  ])('preserves safe domain status/message and optional client details: %o', (cause, status, message) => {
    const error = commandError(cause)
    expect(error).toMatchObject({ status, message })
    if (cause instanceof NotFoundError || cause instanceof ConflictError) {
      expect(error).toHaveProperty('details', cause.details)
    }
    if (error instanceof ApiError) expect(Redacted.isRedacted(error.cause)).toBe(true)
    expect(JSON.stringify(error)).not.toContain('private validation detail')
  })

  it('redacts unexpected driver diagnostics and does not expose arbitrary details', () => {
    const error = commandError(
      Object.assign(new Error('private SQL/token/binding'), { details: { token: 'private-secret' } }),
    )
    expect(error).toMatchObject({ _tag: 'ApiError', status: 500, message: 'The operation could not be completed.' })
    expect(error).not.toHaveProperty('details')
    expect(error instanceof ApiError && Redacted.isRedacted(error.cause)).toBe(true)
    expect(JSON.stringify(error)).not.toContain('private')
  })

  it('preserves existing typed application errors without wrapping them again', () => {
    for (const error of [new ApiError('request', 409, 'Conflict'), new ScopeError(403, 'Denied')]) {
      expect(commandError(error)).toBe(error)
    }
  })
})
