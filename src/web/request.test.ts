import { Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { resetAuthCachesForTests } from '#services/authentication'

import { getRouteParams, makeRequestServices, type PreparedView, RequestServices } from './request'
import { ApiError } from './server'
import { testEnvironment } from './server/test/resources'
import { createTestDatabase } from './test/database'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  resetAuthCachesForTests()
  for (const database of databases.splice(0)) database.close()
})
function fixture() {
  resetAuthCachesForTests()
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO users(id,email,name,created_at) VALUES
      ('first','first@example.test','First',1), ('second','second@example.test','Second',1);
    INSERT INTO workspaces(id,name,slug,created_at) VALUES ('w','Before','alpha',1);
    INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES ('w','first','owner',1);
  `)
  return database
}
const incoming = () => new Request('https://front.example.test/')

describe('request-scoped native services', () => {
  it('reads matched framework parameters without another URL parser', async () => {
    const params = { projectSlug: 'already%decoded', issueNumber: '12' }
    const result = await Effect.runPromise(
      getRouteParams.pipe(
        Effect.provideService(HttpRouter.RouteContext, {
          params,
          route: HttpRouter.route(
            'GET',
            '/projects/:projectSlug/issues/:issueNumber/:titleSlug',
            HttpServerResponse.empty(),
          ),
        }),
      ),
    )
    expect(result).toBe(params)
    expect(await Effect.runPromise(getRouteParams)).toEqual({})
  })

  it('shares concurrent work only inside one verified identity request', async () => {
    const database = fixture()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* makeRequestServices(incoming(), testEnvironment(database.db, 'first@example.test'))
        const second = yield* makeRequestServices(incoming(), testEnvironment(database.db, 'second@example.test'))
        const [a, repeated, b] = yield* Effect.all([first.scope(), first.scope(), second.scope()], { concurrency: 3 })
        return { a, repeated, b, first }
      }),
    )
    expect(result.a).toBe(result.repeated)
    expect(result.a.user.id).toBe('first')
    expect(result.b.user.id).toBe('second')
    expect(result.a.workspaces.map((workspace) => workspace.slug)).toEqual(['alpha'])
    expect(result.b.workspaces).toEqual([])
    expect(result.a.auth).toEqual({ kind: 'human', method: 'dev' })
    expect(result.first).not.toHaveProperty('api')
  })

  it('invalidates only request-owned scope state and reloads authoritative database memberships', async () => {
    const database = fixture()
    const actual = await Effect.runPromise(
      Effect.gen(function* () {
        const env = testEnvironment(database.db, 'first@example.test')
        const services = yield* makeRequestServices(incoming(), env)
        const other = yield* makeRequestServices(incoming(), env)
        const first = yield* services.scope()
        const independent = yield* other.scope()
        database.sqlite.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run('After', 'w')
        const cached = yield* services.scope()
        yield* services.invalidate
        const refreshed = yield* services.scope()
        const otherCached = yield* other.scope()
        return { first, cached, refreshed, independent, otherCached }
      }),
    )
    expect(actual.cached).toBe(actual.first)
    expect(actual.first.workspaces[0].name).toBe('Before')
    expect(actual.refreshed.workspaces[0].name).toBe('After')
    expect(actual.otherCached).toBe(actual.independent)
    expect(actual.otherCached.workspaces[0].name).toBe('Before')
  })

  it('retries failed authentication instead of caching failure permanently', async () => {
    const database = fixture()
    const env = testEnvironment(database.db, 'first@example.test', { ENVIRONMENT: 'production' })
    const actual = await Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* makeRequestServices(incoming(), env)
        const first = yield* services.scope().pipe(Effect.result)
        env.ENVIRONMENT = 'development'
        const recovered = yield* services.scope()
        return { first, recovered }
      }),
    )
    expect(actual.first).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ApiError', status: 401 } })
    expect(actual.recovered.user.id).toBe('first')
  })

  it('invalidates prepared views explicitly, including concurrent work', async () => {
    const database = fixture()
    let renders = 0
    const actual = await Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* makeRequestServices(incoming(), testEnvironment(database.db))
        const view: PreparedView = Effect.gen(function* () {
          const current = yield* RequestServices
          return `${current.url.pathname}:${++renders}`
        })
        const prepare = services.prepare(view).pipe(Effect.provideService(RequestServices, services))
        const [a, cached] = yield* Effect.all([prepare, prepare], { concurrency: 2 })
        yield* services.invalidate
        const refreshed = yield* prepare
        return { a, cached, refreshed }
      }),
    )
    expect(actual.a).toBe(actual.cached)
    expect(actual.refreshed).not.toBe(actual.a)
    expect(renders).toBe(2)
  })

  it('does not permanently cache a failed pre-stream render', async () => {
    const database = fixture()
    let attempts = 0
    const actual = await Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* makeRequestServices(incoming(), testEnvironment(database.db))
        const view: PreparedView = Effect.suspend(() =>
          ++attempts === 1
            ? Effect.fail(new ApiError('request', 500, 'Temporarily unavailable.'))
            : Effect.succeed('Recovered'),
        )
        const prepare = services.prepare(view).pipe(Effect.provideService(RequestServices, services))
        const first = yield* prepare.pipe(Effect.result)
        const second = yield* prepare
        return { first, second }
      }),
    )
    expect(actual.first._tag).toBe('Failure')
    expect(actual.second).toBe('Recovered')
    expect(attempts).toBe(2)
  })
})
