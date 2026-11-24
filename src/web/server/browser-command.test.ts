import { Iterable, Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { CommandOkSchema } from '#core/web/command-contract.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import { coreResult } from '@/core.ts'
import { issueDataFixture } from '@/features/issues/test/data-fixture.ts'
import { makeRequestServices, RequestServices } from '@/request.ts'

import { runBrowserCommand as runCommand } from './browser-command.ts'
import { resolveFunctionContext } from './function-context.ts'
import { testEnvironment } from './test/resources.ts'

const databases: ReturnType<typeof issueDataFixture>[] = []
afterEach(() => {
  Iterable.forEach(databases.splice(0), (database) => {
    database.close()
  })
})
const fixture = function fixture() {
  const database = issueDataFixture()
  databases.push(database)
  const env = testEnvironment(database.db, 'user@example.test')
  const request = new Request('https://front.test/_effront/mutation', {
    method: 'POST',
    headers: { origin: 'https://front.test' },
  })
  const run = <A, E>(effect: Effect.Effect<A, E, RequestServices>) =>
    runTestEffect(
      makeRequestServices(request, env).pipe(
        Effect.flatMap((services) => effect.pipe(Effect.provideService(RequestServices, services))),
      ),
    )
  const context = resolveFunctionContext(
    { workspaceSlug: 'workspace', projectId: 'project-a' },
    { requireProject: true },
  )
  return { database, env, run, context }
}
describe('storage-free browser command composition', () => {
  test('creates only request proof and a named Core client, never a storage capability', async () => {
    const { run, context } = fixture()
    const client = await run(context.pipe(Effect.flatMap((ctx) => runCommand(ctx, Effect.succeed))))
    expect(Object.keys(client).toSorted()).toEqual(['core', 'proof'])
    expect(Object.keys(client.proof).toSorted()).toEqual(['projectId', 'request', 'workspaceSlug'])
    expect(client.proof).toMatchObject({
      projectId: 'project-a',
      request: { method: 'POST' },
      workspaceSlug: 'workspace',
    })
    expect(JSON.stringify(client.proof)).not.toMatch(/userId|role|DB|KV|R2/u)
  })

  test('executes an actual authorized mutation through its concrete Core operation', async () => {
    const { database, run, context } = fixture()
    await run(
      context.pipe(
        Effect.flatMap((ctx) =>
          runCommand(ctx, (client) =>
            coreResult(
              CommandOkSchema,
              client.core.webUpdateIssue(client.proof, 'issue-a', { title: 'Native Core mutation' }),
            ),
          ),
        ),
      ),
    )
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id='issue-a'").get()).toMatchObject({
      title: 'Native Core mutation',
    })
  })

  test('does not trust a previously resolved browser scope when current membership is revoked', async () => {
    const { database, run, context } = fixture()
    const selected = await run(context)
    database.sqlite.exec("DELETE FROM workspace_members WHERE user_id='user-a' AND workspace_id='workspace-a'")
    await expect(
      run(
        runCommand(selected, (client) =>
          coreResult(CommandOkSchema, client.core.webUpdateIssue(client.proof, 'issue-a', { title: 'Denied' })),
        ),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(database.sqlite.prepare("SELECT title FROM issues WHERE id='issue-a'").get()).not.toMatchObject({
      title: 'Denied',
    })
  })

  test('rejects a noninteractive local principal before invoking any operation', async () => {
    const { run, context } = fixture()
    const selected = await run(context)
    await expect(
      run(runCommand({ ...selected, scope: { ...selected.scope, auth: undefined } }, () => Effect.die('must not run'))),
    ).rejects.toMatchObject({ status: 403 })
  })
})
