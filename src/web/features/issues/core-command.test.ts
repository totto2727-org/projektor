import { Effect, Exit } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { decodeCoreReply } from '../../../core/client'
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

describe('private browser command boundary', () => {
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
