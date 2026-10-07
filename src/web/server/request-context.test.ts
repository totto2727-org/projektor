import type { DatabaseSync } from 'node:sqlite'

import type { D1Database } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { schema } from '#db'
import { listProjects } from '#services'

import { createTestDatabase } from '../test/database'
import { TestHttpClient } from '../test/http-client'
import { createRequestApi } from './api-client'
import { visibleProjectPredicate } from './data-context'
import {
  type AuthSession,
  decodeAuthSession,
  decodeProjectCatalog,
  loadRequestScope,
  type ProjectSummary,
  readProjectHint,
  resolveScope,
} from './request-context'

const session: AuthSession = {
  user: { id: 'user-a', email: 'a@example.test', name: 'A' },
  workspaces: [
    { id: 'workspace-a', slug: 'alpha', name: 'Alpha', role: 'member' },
    { id: 'workspace-b', slug: 'beta', name: 'Beta', role: 'viewer' },
  ],
}

const project: ProjectSummary = {
  id: 'project-a',
  key: 'ALPHA',
  slug: 'alpha-project',
  name: 'Project A',
  description: null,
  workspace_id: 'workspace-a',
  workspace_slug: 'alpha',
  workspace_name: 'Alpha',
  open_issue_count: 3,
  backlog_issue_count: 1,
  archived_at: null,
  created_at: 1,
  updated_at: 2,
}
const otherProject: ProjectSummary = {
  ...project,
  id: 'project-b',
  key: 'BETA',
  slug: 'beta-project',
  workspace_id: 'workspace-b',
  workspace_slug: 'beta',
  workspace_name: 'Beta',
}
const projects = [project, otherProject]
const page = (path: string) => new URL(path, 'https://front.example.test')

describe('request scope selection', () => {
  it.each(['/', '/my-issues', '/settings/groups', '/settings/tokens'])(
    'does not require a project or choose a default tenant on %s',
    (path) => {
      expect(resolveScope(session, projects, page(path)).selection).toEqual({ kind: 'global' })
    },
  )

  it.each(['project-a', 'ALPHA', 'alpha-project'])(
    'resolves explicit project %s from its authenticated catalog',
    (hint) => {
      expect(resolveScope(session, projects, page(`/issues?projectId=${hint}`)).selection).toEqual({
        kind: 'project',
        project,
        workspace: session.workspaces[0],
      })
    },
  )

  it('uses a membership-only workspace without needing a project', () => {
    expect(
      resolveScope(session, projects, page('/settings/groups?workspace=beta'), {
        requireWorkspace: true,
      }).selection,
    ).toEqual({
      kind: 'workspace',
      workspace: session.workspaces[1],
    })
  })

  it('does not pick the first of multiple workspaces or projects', () => {
    expect(resolveScope(session, projects, page('/settings/groups'), { requireWorkspace: true }).selection).toEqual({
      kind: 'selection-required',
      target: 'workspace',
      reason: 'ambiguous',
    })
    expect(resolveScope(session, projects, page('/projects/view'), { requireProject: true }).selection).toEqual({
      kind: 'selection-required',
      target: 'project',
      reason: 'ambiguous',
    })
  })

  it('distinguishes empty selection from ambiguity', () => {
    const noMemberships = { ...session, workspaces: [] }
    expect(resolveScope(noMemberships, [], page('/settings/groups'), { requireWorkspace: true }).selection).toEqual({
      kind: 'selection-required',
      target: 'workspace',
      reason: 'empty',
    })
    expect(resolveScope(noMemberships, [], page('/issues'), { requireProject: true }).selection).toEqual({
      kind: 'selection-required',
      target: 'project',
      reason: 'empty',
    })
  })

  it('selects a unique required project, but not for a global page', () => {
    expect(resolveScope(session, [project], page('/projects/view'), { requireProject: true }).selection).toMatchObject({
      kind: 'project',
      project,
    })
    expect(resolveScope(session, [project], page('/')).selection).toEqual({ kind: 'global' })
  })

  it('fails closed on unknown workspace or contradictory project/workspace', () => {
    expect(() => resolveScope(session, projects, page('/settings/groups?workspace=missing'))).toThrow(
      'Selected workspace is not accessible.',
    )
    expect(() => resolveScope(session, projects, page('/issues?projectId=project-a&workspace=beta'))).toThrow(
      'Selected project is not accessible.',
    )
  })

  it('does not trust a catalog project without the matching current membership', () => {
    expect(() => resolveScope({ ...session, workspaces: [] }, projects, page('/issues?projectId=project-a'))).toThrow(
      'Selected project is not accessible.',
    )
  })

  it('requires selection when project keys collide across workspaces', () => {
    const collision = { ...otherProject, key: 'ALPHA' }
    expect(resolveScope(session, [project, collision], page('/issues?project=ALPHA')).selection).toEqual({
      kind: 'selection-required',
      target: 'project',
      reason: 'ambiguous',
    })
    expect(
      resolveScope(session, [project, collision], page('/issues?project=ALPHA&workspace=beta')).selection,
    ).toMatchObject({ kind: 'project', project: collision })
  })

  it.each(['/issues/view?id=entity', '/wiki/view?id=entity', '/feedback/view?id=entity'])(
    'does not reinterpret entity id on %s as a project',
    (path) => {
      expect(readProjectHint(page(path))).toBeUndefined()
    },
  )

  it('reads legacy query ids and accepts project identity supplied by the framework route', () => {
    expect(readProjectHint(page('/projects/view?id=project-a'))).toBe('project-a')
    expect(readProjectHint(page('/projects/view/alpha-project/'))).toBeUndefined()
    expect(
      resolveScope(session, projects, page('/projects/view/alpha-project'), {
        projectHint: 'alpha-project',
      }).selection,
    ).toMatchObject({ kind: 'project', project })
    expect(readProjectHint(page('/projects/alpha-project/issues/12/title'))).toBeUndefined()
  })

  it('rejects conflicting repeated hints without parsing path encoding again', () => {
    expect(() => readProjectHint(page('/issues?projectId=a&projectId=b'))).toThrow('Ambiguous projectId parameter.')
    expect(readProjectHint(page('/projects/%E0%A4/issues/12/title'))).toBeUndefined()
  })
})

describe('server scope loading', () => {
  let sqlite: DatabaseSync
  let db: D1Database
  let prepare: ReturnType<typeof vi.fn>
  const transport = vi.fn<typeof fetch>()
  beforeEach(() => {
    // Real migrated SQL through the shared D1-shaped transport, not a Worker emulator.
    const fixture = createTestDatabase()
    sqlite = fixture.sqlite
    db = fixture.db
    prepare = vi.spyOn(db, 'prepare')
    sqlite.exec(`
			INSERT INTO users (id,email,name,created_at) VALUES ('user-a','a@example.test','A',1);
			INSERT INTO workspaces (id,name,slug,created_at) VALUES
			 ('workspace-a','Alpha','alpha',1), ('workspace-b','Beta','beta',1), ('workspace-c','Hidden','hidden',1);
			INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES
			 ('workspace-a','user-a','member',1), ('workspace-b','user-a','viewer',1);
			INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES
			 ('project-a','workspace-a','Project A','ALPHA','alpha-project',1,2),
			 ('project-b','workspace-b','Project B','BETA','beta-project',1,2),
			 ('project-hidden','workspace-a','No Grant','SECRET','secret',1,2),
			 ('project-other-tenant','workspace-c','Hidden','OTHER','other',1,2);
			INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('group-a','workspace-a','Readers',1);
			INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('group-a','user-a','user-a',1);
			INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('group-a','project-a','viewer');
		`)
    transport.mockReset().mockImplementation(async (input, init) => {
      expect(new URL(input instanceof Request ? input.url : input).pathname).toBe('/auth/me')
      expect(new Headers(init?.headers).get('x-workspace-slug')).toBeNull()
      return Response.json(session)
    })
  })
  afterEach(() => sqlite.close())
  function load(request = new Request(page('/')), database = db) {
    return Effect.runPromise(
      createRequestApi(request, { apiBaseUrl: 'https://api.example.test' }).pipe(
        Effect.flatMap((api) => loadRequestScope(api, new URL(request.url), {}, { db: database, request })),
        Effect.provide(TestHttpClient),
        Effect.provideService(FetchHttpClient.Fetch, transport),
      ),
    )
  }

  it('verifies auth once then reads only granted projects directly, without inherited workspace header', async () => {
    const request = new Request(page('/issues?projectId=project-a'), {
      headers: { 'cf-access-jwt-assertion': 'access-credential', 'x-workspace-slug': 'unrelated' },
    })
    const scope = await load(request)
    expect(scope.selection).toMatchObject({ kind: 'project', project: { id: 'project-a' } })
    expect(scope.projects.map((item) => item.id)).toEqual(['project-a'])
    expect(transport).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(scope)).not.toContain('access-credential')
  })
  it('retries archived DB catalog exactly once and leaves ordinary catalog active-only', async () => {
    sqlite.exec("UPDATE projects SET archived_at = 42 WHERE id = 'project-a'")
    expect((await load()).projects).toEqual([])
    prepare.mockClear()
    const scope = await load(new Request(page('/issues?projectId=project-a')))
    expect(scope.selection).toMatchObject({
      kind: 'project',
      project: { id: 'project-a', archived_at: 42 },
    })
    expect(prepare).toHaveBeenCalledTimes(2)
  })
  it.each(['Bearer workspace-restricted', 'Bearer read-restricted', 'Basic other', ''])(
    'rejects Authorization %s before auth or DB even with Access credentials',
    async (authorization) => {
      await expect(
        load(
          new Request(page('/'), {
            headers: { authorization, 'cf-access-jwt-assertion': 'access' },
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'ScopeError', status: 403 })
      expect(transport).not.toHaveBeenCalled()
      expect(prepare).not.toHaveBeenCalled()
    },
  )
  it('fails closed before DB on invalid API authentication and malformed session', async () => {
    transport.mockResolvedValueOnce(new Response('Denied', { status: 401 }))
    await expect(load()).rejects.toMatchObject({ _tag: 'ApiError', status: 401 })
    transport.mockResolvedValueOnce(Response.json({ malformed: true }))
    await expect(load()).rejects.toMatchObject({ _tag: 'ApiError', kind: 'schema', status: 502 })
    expect(prepare).not.toHaveBeenCalled()
  })
  it('rejects anonymous public-viewer sessions before any data query', async () => {
    transport.mockResolvedValueOnce(
      Response.json({
        ...session,
        user: { ...session.user, email: 'public-viewer@projektor.local' },
      }),
    )
    await expect(load()).rejects.toMatchObject({ _tag: 'ScopeError', status: 403 })
    expect(prepare).not.toHaveBeenCalled()
  })
  it('uses actual membership roles and refreshes grant visibility each request', async () => {
    expect((await load()).projects.map((item) => item.id)).toEqual(['project-a'])
    sqlite.exec(
      "DELETE FROM group_project_grants; UPDATE workspace_members SET role='admin' WHERE workspace_id='workspace-b'",
    )
    expect((await load()).projects.map((item) => item.id)).toEqual(['project-b'])
    await expect(load(new Request(page('/issues?projectId=project-hidden')))).rejects.toMatchObject({
      _tag: 'ScopeError',
      status: 404,
    })
  })
  it('keeps API-confirmed memberships as an additional boundary', async () => {
    transport.mockResolvedValueOnce(Response.json({ ...session, workspaces: [] }))
    expect((await load()).projects).toEqual([])
  })
  it('applies the web app grant predicate to shared workspace-scoped list queries', async () => {
    const scope = await load()
    const rows = await Effect.runPromise(
      listProjects(db, 'workspace-a', {
        visibility: visibleProjectPredicate(scope, 'workspace-a', schema.projects.id),
      }),
    )
    expect(rows.map((row) => row.id)).toEqual(['project-a'])
    sqlite.exec('DELETE FROM user_group_members')
    expect(
      await Effect.runPromise(
        listProjects(db, 'workspace-a', {
          visibility: visibleProjectPredicate(scope, 'workspace-a', schema.projects.id),
        }),
      ),
    ).toEqual([])
  })
  it('fails closed on missing DB and redacts SQL failures without API catalog fallback', async () => {
    await expect(load(new Request(page('/')), null as unknown as D1Database)).rejects.toMatchObject({
      _tag: 'ApiError',
      kind: 'configuration',
      status: 500,
    })
    await expect(load(new Request(page('/')), {} as D1Database)).rejects.toMatchObject({
      _tag: 'ApiError',
      kind: 'configuration',
      status: 500,
    })
    prepare.mockImplementationOnce(() => {
      throw new Error('secret SQL credential')
    })
    try {
      await load()
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toMatchObject({
        _tag: 'ApiError',
        status: 500,
        message: 'Unable to load project data.',
      })
      expect(JSON.stringify(error)).not.toContain('secret SQL credential')
    }
  })

  it('rejects weak/malformed membership and project payloads instead of casting them', () => {
    expect(() => decodeAuthSession({ user: session.user, workspaces: [{ slug: 'alpha', role: 'owner' }] })).toThrow()
    expect(() => decodeProjectCatalog([{ ...project, workspace_slug: null }])).toThrow()
  })
})
