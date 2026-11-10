import { Effect, Exit } from 'effect'
import { decodeCoreReply } from 'projektor/core-client'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { CommandOkSchema, type BrowserCommand } from '../../../core/web/command-contract'
import { makeWebCoreHandlers } from '../../../core/web/operations'
import { browserRequest } from '../../core'
import { testEnvironment } from '../../server/test/resources'
import { issueDataFixture } from './test/data-fixture'

const databases: ReturnType<typeof issueDataFixture>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = issueDataFixture()
  databases.push(database)
  const env = testEnvironment(database.db, 'user@example.test')
  const handlers = makeWebCoreHandlers(Effect.succeed(env))
  const proof: BrowserCommand = {
    request: browserRequest(
      new Request('https://front.test/_effront/query', { method: 'POST', headers: { origin: 'https://front.test' } }),
    ),
    workspaceSlug: 'workspace',
    projectId: 'project-a',
  }
  const invoke = (input: BrowserCommand) =>
    Effect.runPromiseExit(
      decodeCoreReply(CommandOkSchema, handlers.webUpdateIssue(input, 'issue-a', { title: 'From Core' })),
    )
  return { database, env, proof, invoke }
}

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

describe('private browser command boundary', () => {
  it('accepts a cryptographically verified Access identity without development fallback', async () => {
    const { env, proof, invoke } = fixture()
    const signed = await signedAccess('user@example.test')
    env.ENVIRONMENT = 'production'
    env.CF_ACCESS_TEAM_DOMAIN = 'team.example.test'
    env.CF_ACCESS_AUDIENCE = 'test-audience'
    await env.KV.put('cf-access-certs', JSON.stringify([signed.jwk]))
    const request = {
      ...proof.request,
      headers: [...proof.request.headers, ['Cf-Access-Jwt-Assertion', signed.token] as const],
    }
    expect(Exit.isSuccess(await invoke({ ...proof, request }))).toBe(true)
  })
  it.each(['missing', 'bearer', 'invalid-access', 'public-viewer'] as const)(
    'rejects %s browser provenance before a mutation',
    async (kind) => {
      const { env, proof, invoke, database } = fixture()
      if (kind === 'missing') env.ENVIRONMENT = 'production'
      if (kind === 'public-viewer') env.DEV_USER_EMAIL = 'public-viewer@projektor.local'
      const headers = [...proof.request.headers]
      if (kind === 'bearer') headers.push(['Authorization', 'Bearer pk_test'])
      if (kind === 'invalid-access') headers.push(['Cf-Access-Jwt-Assertion', 'invalid-token'])
      expect(Exit.isFailure(await invoke({ ...proof, request: { ...proof.request, headers } }))).toBe(true)
      expect(database.sqlite.prepare("SELECT title FROM issues WHERE id='issue-a'").get()).not.toMatchObject({
        title: 'From Core',
      })
    },
  )
  it('persists the explicit authorized operation through the encoded boundary', async () => {
    const { database, proof, invoke } = fixture()
    expect(Exit.isSuccess(await invoke(proof))).toBe(true)
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id='issue-a'").get()).toMatchObject({
      title: 'From Core',
    })
  })
  it('rejects a forged cross-origin call without trusting frontend preflight', async () => {
    const { database, proof, invoke } = fixture()
    const result = await invoke({ ...proof, request: { ...proof.request, headers: [['origin', 'https://evil.test']] } })
    expect(Exit.isFailure(result)).toBe(true)
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id='issue-a'").get()).not.toMatchObject({
      title: 'From Core',
    })
  })
  it('rechecks the current identity and selected workspace inside Core', async () => {
    const { database, env, proof, invoke } = fixture()
    env.DEV_USER_EMAIL = 'not-a-member@example.test'
    expect(Exit.isFailure(await invoke(proof))).toBe(true)
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id='issue-a'").get()).not.toMatchObject({
      title: 'From Core',
    })
  })
})
