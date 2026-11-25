import { Credentials } from '@distilled.cloud/cloudflare/Credentials'
import { NodeServices } from '@effect/platform-node'
import { Stack } from 'alchemy'
import { CloudflareEnvironment, D1, KV, R2 } from 'alchemy/Cloudflare'
import { noopSession } from 'alchemy/Report'
import { Stage } from 'alchemy/Stage'
import { Effect, Redacted } from 'effect'
import type { FileSystem, Path } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { describe, expect, test } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'

import { deployment } from './worker-graph.ts'

const { accountId, storage } = deployment
const apiToken = Redacted.make('test-only-token')
const identity = { id: 'Storage', fqn: 'Storage', instanceId: 'test' }
const session = { ...noopSession, note: () => Effect.void }

const fakeCloudflare = function fakeCloudflare(responses: Readonly<Record<string, unknown>>) {
  const calls: string[] = []
  const client = HttpClient.make((request, url) => {
    const call = `${request.method} ${url.pathname.replace(`/accounts/${accountId}/`, '')}`
    calls.push(call)
    if (url.origin !== 'https://cloudflare.test' || !Object.hasOwn(responses, call)) {
      return Effect.die(new Error(`Unexpected Cloudflare request: ${call}`))
    }
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({ success: true, result: responses[call] })),
    )
  })
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      CloudflareEnvironment | Credentials | HttpClient.HttpClient | FileSystem.FileSystem | Path.Path | Stack | Stage
    >,
  ): Promise<A> =>
    runTestEffect(
      effect.pipe(
        Effect.provide(NodeServices.layer),
        Effect.provideService(Stage, 'production'),
        Effect.provideService(Stack, {
          name: 'storage-adoption',
          stage: 'production',
          resources: {},
          bindings: {},
          actions: {},
        }),
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(
          Credentials,
          Effect.succeed({ type: 'apiToken', apiToken, apiBaseUrl: 'https://cloudflare.test' }),
        ),
        Effect.provideService(
          CloudflareEnvironment,
          Effect.succeed({ type: 'apiToken', apiToken, accountId, source: { type: 'env' } }),
        ),
      ),
    )
  return { run, calls }
}

describe('covers Cloudflare storage adoption', () => {
  test('plans adoption of the existing D1 without SQL and reconciles without recreating it', async () => {
    expect.hasAssertions()
    const { id, name } = storage.database
    const database = { uuid: id, name, read_replication: { mode: 'disabled' } }
    const { run, calls } = fakeCloudflare({
      'GET d1/database': [{ uuid: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', name: `${name}-other` }, database],
      [`GET d1/database/${id}`]: database,
    })
    const props = { name }
    await run(
      Effect.gen(function* () {
        const provider = yield* D1.Database.Provider
        if (!provider.read || !provider.diff) {
          throw new Error('D1 provider lacks read or diff')
        }
        const output = yield* provider.read({ ...identity, olds: props, output: undefined })
        expect(output?.databaseId).toBe(id)
        expect(
          yield* provider.diff({ ...identity, olds: props, news: props, output, oldBindings: [], newBindings: [] }),
        ).toBeUndefined()
        expect(calls).toStrictEqual(['GET d1/database'])
        const reconciled = yield* provider.reconcile({
          ...identity,
          olds: undefined,
          news: props,
          output,
          session,
          bindings: [],
        })
        expect(reconciled.databaseId).toBe(id)
      }).pipe(Effect.provide(D1.ProviderLive())),
    )
    expect(calls).toStrictEqual(['GET d1/database', `GET d1/database/${id}`])
  })

  test.each([storage.cache, storage.oauth])('adopts KV namespace $title by exact title', async ({ id, title }) => {
    expect.hasAssertions()
    const path = 'storage/kv/namespaces'
    const namespaces = [storage.cache, storage.oauth]
    const { run, calls } = fakeCloudflare({
      [`GET ${path}`]: namespaces,
      [`GET ${path}/${id}`]: { id, title },
    })
    const props = { title }
    await run(
      Effect.gen(function* () {
        const provider = yield* KV.Namespace.Provider
        if (!provider.read) {
          throw new Error('KV provider lacks read')
        }
        const output = yield* provider.read({ ...identity, olds: props, output: undefined })
        expect(output?.namespaceId).toBe(id)
        const reconciled = yield* provider.reconcile({
          ...identity,
          olds: undefined,
          news: props,
          output,
          session,
          bindings: [],
        })
        expect(reconciled.namespaceId).toBe(id)
      }).pipe(Effect.provide(KV.ProviderLive())),
    )
    expect(calls).toStrictEqual([`GET ${path}`, `GET ${path}/${id}`])
  })

  test('reconciles an existing private R2 bucket with matching settings without writes', async () => {
    expect.hasAssertions()
    const { name } = storage.files
    const path = `r2/buckets/${name}`
    const rule = {
      id: 'Default Multipart Abort Rule',
      abortMultipartUploadsTransition: { condition: { type: 'Age' as const, maxAge: 604_800 } },
    }
    const { run, calls } = fakeCloudflare({
      [`GET ${path}`]: { name, storage_class: 'Standard', jurisdiction: 'default', location: 'APAC' },
      [`GET ${path}/domains/custom`]: { domains: [] },
      [`GET ${path}/domains/managed`]: { bucketId: 'existing-bucket', domain: 'existing.r2.dev', enabled: false },
      [`GET ${path}/cors`]: { rules: [] },
      [`GET ${path}/lifecycle`]: { rules: [{ ...rule, enabled: true, conditions: {} }] },
    })
    const props = { name, publicAccess: false, lifecycleRules: [rule] }
    await run(
      Effect.gen(function* () {
        const provider = yield* R2.Bucket.Provider
        if (!provider.read) {
          throw new Error('R2 provider lacks read')
        }
        const output = yield* provider.read({ ...identity, olds: props, output: undefined })
        expect(output?.bucketName).toBe(name)
        const reconciled = yield* provider.reconcile({
          ...identity,
          olds: undefined,
          news: props,
          output,
          session,
          bindings: [],
        })
        expect(reconciled).toMatchObject({
          accountId,
          bucketName: name,
          jurisdiction: 'default',
          storageClass: 'Standard',
        })
        expect(reconciled.publicDomain).toBeUndefined()
      }).pipe(Effect.provide(R2.ProviderLive())),
    )
    expect(calls.filter((call) => call === `GET ${path}`)).toHaveLength(2)
    expect(calls.every((call) => call.startsWith('GET '))).toBe(true)
  })
})
