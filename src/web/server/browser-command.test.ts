import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { CommandOkSchema } from '../../core/web/command-contract'
import { coreResult } from '../core'
import { issueDataFixture } from '../features/issues/test/data-fixture'
import { makeRequestServices, RequestServices } from '../request'
import { runBrowserCommand as runCommand } from './browser-command'
import { resolveFunctionContext } from './function-context'
import { testEnvironment } from './test/resources'

const databases: ReturnType<typeof issueDataFixture>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
function fixture() {
  const database = issueDataFixture()
  databases.push(database)
  const env = testEnvironment(database.db, 'user@example.test')
  const request = new Request('https://front.test/_effront/mutation', {
    method: 'POST',
    headers: { origin: 'https://front.test' },
  })
  const run = <A, E>(effect: Effect.Effect<A, E, RequestServices>) =>
    Effect.runPromise(
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
  it('creates only request proof and a named Core client, never a storage capability', async () => {
    const { run, context } = fixture()
    const client = await run(context.pipe(Effect.flatMap((ctx) => runCommand(ctx, Effect.succeed))))
    expect(Object.keys(client).sort()).toEqual(['core', 'proof'])
    expect(Object.keys(client.proof).sort()).toEqual(['projectId', 'request', 'workspaceSlug'])
    expect(client.proof).toMatchObject({
      projectId: 'project-a',
      workspaceSlug: 'workspace',
      request: { method: 'POST' },
    })
    expect(JSON.stringify(client.proof)).not.toMatch(/userId|role|DB|KV|R2/)
  })
  it('executes an actual authorized mutation through its concrete Core operation', async () => {
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
  it('does not trust a previously resolved browser scope when current membership is revoked', async () => {
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
  it('rejects a noninteractive local principal before invoking any operation', async () => {
    const { run, context } = fixture()
    const selected = await run(context)
    await expect(
      run(runCommand({ ...selected, scope: { ...selected.scope, auth: undefined } }, () => Effect.die('must not run'))),
    ).rejects.toMatchObject({ status: 403 })
  })
})
