import { Iterable, Cause, Effect, Exit } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { resetAuthCachesForTests } from '#services/authentication.ts'
import { JSON_NULL } from '#tests/json-null.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import { makeRequestServices, RequestServices } from '@/request.ts'
import { createTestDatabase } from '@/test/database.ts'

import { resolveFunctionContext } from './function-context.ts'
import type { FunctionOptions, FunctionSelector } from './function-context.ts'
import type { AuthSession, ProjectSummary } from './request-context.ts'
import { testEnvironment } from './test/resources.ts'

const session: AuthSession = {
  user: { id: 'user-a', email: 'a@example.test', name: 'A' },
  workspaces: [
    { id: 'workspace-a', slug: 'alpha', name: 'Alpha', role: 'member' },
    { id: 'workspace-b', slug: 'beta', name: 'Beta', role: 'viewer' },
  ],
}
const project: ProjectSummary = {
  id: 'project-a',
  name: 'Project A',
  key: 'ALPHA',
  slug: 'alpha-project',
  description: JSON_NULL,
  workspace_id: 'workspace-a',
  workspace_name: 'Alpha',
  workspace_slug: 'alpha',
  open_issue_count: 0,
  backlog_issue_count: 0,
  archived_at: JSON_NULL,
  created_at: 1,
  updated_at: 2,
}

const databases: ReturnType<typeof createTestDatabase>[] = []

const fixture = function fixture(
  path = '/_effront/query',
  auth: AuthSession = session,
  catalog: Readonly<ProjectSummary[]> = [project],
) {
  resetAuthCachesForTests()
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite
    .prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,1)')
    .run(auth.user.id, auth.user.email, auth.user.name)
  Iterable.forEach(session.workspaces, (workspace) => {
    database.sqlite
      .prepare('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,1)')
      .run(workspace.id, workspace.name, workspace.slug)
  })
  Iterable.forEach(auth.workspaces, (workspace) => {
    database.sqlite
      .prepare('INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,?,1)')
      .run(workspace.id, auth.user.id, workspace.role)
  })
  Iterable.forEach(catalog, (item) => {
    database.sqlite
      .prepare(
        'INSERT INTO projects(id,workspace_id,name,key,slug,description,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        item.id,
        item.workspace_id,
        item.name,
        item.key,
        item.slug,
        item.description,
        item.created_at,
        item.updated_at,
        item.archived_at,
      )
    database.sqlite
      .prepare('INSERT INTO user_groups(id,workspace_id,name,created_at) VALUES(?,?,?,1)')
      .run(`group-${item.id}`, item.workspace_id, `Group ${item.id}`)
    database.sqlite
      .prepare('INSERT INTO user_group_members(group_id,user_id,added_by,added_at) VALUES(?,?,?,1)')
      .run(`group-${item.id}`, auth.user.id, auth.user.id)
    database.sqlite
      .prepare("INSERT INTO group_project_grants(group_id,project_id,role) VALUES(?,?, 'viewer')")
      .run(`group-${item.id}`, item.id)
  })
  const invalidated = vi.fn<() => void>()
  const env = testEnvironment(database.db, auth.user.email)
  const run = function run<A, E>(operation: Effect.Effect<A, E, RequestServices>): Promise<A> {
    return runTestEffect(
      Effect.gen(function* () {
        const request = new Request(`https://front.example.test${path}`, {
          method: 'POST',
          headers: {
            'x-user-id': 'spoofed',
            'x-workspace-slug': 'untrusted',
            origin: 'https://front.example.test',
          },
        })
        const services = yield* makeRequestServices(request, env)
        return yield* operation.pipe(
          Effect.provideService(RequestServices, {
            ...services,
            invalidate: services.invalidate.pipe(Effect.tap(() => Effect.sync(invalidated))),
          }),
        )
      }),
    )
  }
  return { run, env, database, invalidated }
}

describe('independent ServerFn authentication and semantic selection', () => {
  afterEach(() => {
    resetAuthCachesForTests()
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test('resolves a workspace query without a page URL or inferred project', async () => {
    const { run, invalidated } = fixture()
    const context = await run(resolveFunctionContext({ workspaceSlug: 'alpha' }, { requireWorkspace: true }))
    expect(context.workspaceSlug).toBe('alpha')
    expect(context.projectId).toBeUndefined()
    expect(context.scope.selection.kind).toBe('workspace')
    expect(context.scope.user.id).toBe('user-a')
    expect(context.scope.auth).toStrictEqual({ kind: 'human', method: 'dev' })
    expect(context).not.toHaveProperty('api')
    expect(invalidated).not.toHaveBeenCalled()
  })

  test('uses an explicit project ID to derive its authenticated workspace', async () => {
    const { run } = fixture()
    const context = await run(
      resolveFunctionContext({ projectId: 'project-a' }, { requireProject: true, requireWorkspace: true }),
    )
    expect(context.workspaceSlug).toBe('alpha')
    expect(context.projectId).toBe('project-a')
  })

  test('does not inherit workspace/project hints from the invoking page', async () => {
    const { run } = fixture('/issues?workspace=alpha&projectId=project-a')
    const context = await run(resolveFunctionContext({}))
    expect(context.scope.selection).toStrictEqual({ kind: 'global' })
    expect(context.workspaceSlug).toBeUndefined()
    expect(context.projectId).toBeUndefined()
  })

  test('lets explicit workspace selection replace unrelated page context', async () => {
    const { run } = fixture('/issues?workspace=alpha&projectId=project-a')
    const context = await run(resolveFunctionContext({ workspaceSlug: 'beta' }, { requireWorkspace: true }))
    expect(context.workspaceSlug).toBe('beta')
    expect(context.projectId).toBeUndefined()
  })

  test.each([
    [{ requireWorkspace: true }, 'Select a workspace for this operation.'],
    [{ requireProject: true }, 'Select a project for this operation.'],
  ] satisfies Readonly<Readonly<[FunctionOptions, string]>[]>)(
    'rejects missing explicit selectors even with a unique catalog: %o',
    async (options, message) => {
      const { run } = fixture('/_effront/query', {
        ...session,
        workspaces: [session.workspaces[0]],
      })
      await expect(run(resolveFunctionContext({}, options))).rejects.toMatchObject({
        _tag: 'ScopeError',
        message,
        status: 400,
      })
    },
  )

  test.each([{ workspaceSlug: '' }, { projectId: '' }] satisfies Readonly<FunctionSelector[]>)(
    'rejects malformed semantic selection: %o',
    async (selector) => {
      const { run, database } = fixture()
      database.sqlite.exec('DROP TABLE users')
      await expect(run(resolveFunctionContext(selector))).rejects.toMatchObject({
        _tag: 'ScopeError',
        status: 400,
      })
    },
  )

  test('rejects a workspace outside current membership', async () => {
    const { run } = fixture()
    await expect(run(resolveFunctionContext({ workspaceSlug: 'missing' }))).rejects.toMatchObject({
      _tag: 'ScopeError',
      status: 403,
    })
  })

  test('rejects contradictory workspace/project selection', async () => {
    const { run } = fixture()
    await expect(run(resolveFunctionContext({ workspaceSlug: 'beta', projectId: 'project-a' }))).rejects.toMatchObject({
      _tag: 'ScopeError',
      status: 404,
    })
  })

  test('requires actual project IDs, not a matching key or slug alias', async () => {
    const { run } = fixture()
    await expect(run(resolveFunctionContext({ projectId: 'ALPHA' }))).rejects.toMatchObject({
      _tag: 'ScopeError',
      status: 404,
    })
  })

  test('rejects catalog entities whose membership has been revoked', async () => {
    const { run } = fixture('/_effront/query', { ...session, workspaces: [] })
    await expect(run(resolveFunctionContext({ projectId: 'project-a' }))).rejects.toMatchObject({
      _tag: 'ScopeError',
      status: 404,
    })
  })

  test('preserves typed authentication failures and never invalidates during resolution', async () => {
    const { run, env, invalidated } = fixture()
    env.ENVIRONMENT = 'production'
    await expect(run(resolveFunctionContext({}))).rejects.toMatchObject({
      _tag: 'ApiError',
      status: 401,
    })
    expect(invalidated).not.toHaveBeenCalled()
  })

  test('does not catch defects or transform interruption into a result abstraction', async () => {
    const { run } = fixture()
    const failure = new Error('programmer defect')
    const defect = await run(
      Effect.gen(function* () {
        const services = yield* RequestServices
        return yield* resolveFunctionContext({}).pipe(
          Effect.provideService(RequestServices, { ...services, scope: () => Effect.die(failure) }),
          Effect.exit,
        )
      }),
    )
    expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true)
    const interrupted = await run(
      Effect.gen(function* () {
        const services = yield* RequestServices
        return yield* resolveFunctionContext({}).pipe(
          Effect.provideService(RequestServices, { ...services, scope: () => Effect.interrupt }),
          Effect.exit,
        )
      }),
    )
    expect(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause)).toBe(true)
  })
})
