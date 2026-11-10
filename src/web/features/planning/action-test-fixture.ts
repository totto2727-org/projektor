import { Effect, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { afterEach, vi } from 'vite-plus/test'

import { type Env, makeRequestServices, RequestServices } from '../../request'
import { inMemoryKV, inMemoryR2, testEnvironment } from '../../server/test/resources'
import { createTestDatabase } from '../../test/database'

type InputSchema = Schema.Constraint & Schema.Decoder<unknown>
interface Definition {
  input: InputSchema | readonly InputSchema[]
  handler: (...input: unknown[]) => Effect.Effect<unknown, unknown, RequestServices>
}
const definitions = vi.hoisted(() => new WeakMap<object, Definition>())
/** Capture only framework registration. Real schemas, browser authentication and commands run. */
vi.mock('../../effront', () => ({
  EFFRONT: {
    ServerFn: {
      make: (definition: Definition) => {
        const callable = () => Promise.reject(new Error('Use the maintained action test boundary.'))
        definitions.set(callable, definition)
        return callable
      },
    },
  },
}))
vi.mock('@effront/core/workers', async () => {
  const { Effect } = await import('effect')
  return {
    getWorkersRequestContext: () => Effect.die('Host context is not used by feature action tests.'),
  }
})
const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

/** Shared page/action fixtures execute every read against the fully migrated real schema. */
export function featureDatabase() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
		INSERT INTO users (id,email,name,created_at) VALUES ('u1','owner@example.test','Owner',1);
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w1','Alpha','alpha',1), ('w2','Beta','beta',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner',1);
		INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES
			('p1','w1','Project','PROJ','project',1,1), ('other','w1','Other','OTHER','other',1,1),
			('foreign','w2','Foreign','FOREIGN','foreign',1,1);
		INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES
			('s1','w1','p1','Sprint','planned',1,1), ('s2','w1','p1','Next sprint','planned',2,2),
			('foreign-sprint','w2','foreign','Private sprint','planned',1,1);
    CREATE VIRTUAL TABLE issues_fts USING fts5(issue_id UNINDEXED, workspace_id UNINDEXED, title, body);
    CREATE VIRTUAL TABLE wiki_fts USING fts5(page_id UNINDEXED, workspace_id UNINDEXED, title, content, tags);
	`)
  return database
}

export const planningIds = {
  project: '00000000-0000-4000-8000-000000000001',
  source: '00000000-0000-4000-8000-000000000002',
  target: '00000000-0000-4000-8000-000000000003',
}

export function actionFixture(
  resolve: (url: URL, options?: RequestInit) => unknown = () => {
    throw new Error('Web actions must not use an API transport.')
  },
  origin = 'https://front.example',
  overrides: Partial<Env> = {},
) {
  const database = featureDatabase()
  const kv = inMemoryKV()
  const r2 = inMemoryR2()
  const oauthKV = inMemoryKV()
  const env = testEnvironment(database.db, 'owner@example.test', {
    KV: kv,
    R2: r2,
    OAUTH_KV: oauthKV,
    DEFAULT_WORKSPACE_SLUG: 'alpha',
    AUTO_JOIN_ROLE: 'none',
    ...overrides,
    DB: database.db,
  })
  const invalidated = vi.fn()
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const value = await resolve(url, options)
    return value instanceof Response ? value : Response.json(value)
  })
  function invoke<Input extends unknown[], Output>(operation: (...input: Input) => Promise<Output>, ...input: Input) {
    const definition = definitions.get(operation)
    if (!definition) throw new Error('Unregistered feature ServerFn.')
    return Effect.runPromise(
      Effect.gen(function* () {
        const services = yield* makeRequestServices(
          new Request('https://front.example/_effront/functions', {
            method: 'POST',
            headers: { origin },
          }),
          env,
        )
        const spread = Array.isArray(definition.input)
        const schema = spread ? Schema.Tuple(definition.input as InputSchema[]) : (definition.input as InputSchema)
        const value = yield* Schema.decodeUnknownEffect(schema)(spread ? input : input[0])
        return yield* (spread ? definition.handler(...(value as unknown[])) : definition.handler(value)).pipe(
          Effect.provideService(RequestServices, {
            ...services,
            invalidate: services.invalidate.pipe(Effect.tap(() => Effect.sync(invalidated))),
          }),
        )
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.Fetch, transport)),
    )
  }
  return { invoke, transport, invalidated, env, kv, r2, oauthKV, ...database }
}

/** Native action test boundary uses the browser's actual submitted fields. */
export function formData(values: Record<string, string | number>) {
  const data = new FormData()
  for (const [name, value] of Object.entries(values)) data.set(name, String(value))
  return data
}
