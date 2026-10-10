import { Effect } from 'effect'
import { isValidElement, type ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'

import { resetProvisioningCacheForTests } from '#commands/provisioning'
import { resetAuthCachesForTests } from '#services/authentication'

import { makeRequestServices, RequestServices } from '../../request'
import type { ApiError, ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { testEnvironment } from '../../server/test/resources'
import { featureDatabase } from '../planning/action-test-fixture'
import type { ProjectLanding } from './ProjectLanding'
import type { ProjectList } from './ProjectList'
import { renderOverview, renderProjects } from './server'

vi.mock('./actions', () => ({
  createProject: vi.fn(),
  updateDescription: vi.fn(),
  archiveProject: vi.fn(),
}))

function runWithDatabase<T>(
  database: ReturnType<typeof featureDatabase>,
  url: URL,
  use: (scope: RequestScope) => Effect.Effect<T, ApiError | ScopeError, RequestServices>,
) {
  resetAuthCachesForTests()
  resetProvisioningCacheForTests()
  const transport = vi.spyOn(globalThis, 'fetch')
  const result = Effect.runPromise(
    Effect.gen(function* () {
      const services = yield* makeRequestServices(new Request(url), testEnvironment(database.db))
      const scope = yield* services.scope()
      return yield* use(scope).pipe(Effect.provideService(RequestServices, services))
    }),
  )
  return { result, transport }
}

describe('project pages read named shared queries against migrated D1', () => {
  it('uses the request catalog for active projects and directly loads the archived catalog', async () => {
    const database = featureDatabase()
    database.sqlite.exec("UPDATE projects SET archived_at=99 WHERE id='other'")
    for (const archived of [false, true]) {
      const url = new URL(`https://front.example/projects${archived ? '?includeArchived=true' : ''}`)
      const run = runWithDatabase(database, url, (scope) => renderProjects(scope, url))
      const node = await run.result
      if (!isValidElement<ComponentProps<typeof ProjectList>>(node)) throw new Error('Expected project list')
      expect(node.props.initialProjects.map((project) => project.id)).toEqual(archived ? ['other', 'p1'] : ['p1'])
      expect(node.props.showArchived).toBe(archived)
      expect(run.transport).toHaveBeenCalledTimes(0)
    }
  })
  it('restricts the archived catalog to actual membership and group grants', async () => {
    const database = featureDatabase()
    database.sqlite.exec(`UPDATE workspace_members SET role='member' WHERE user_id='u1';
			UPDATE projects SET archived_at=99 WHERE id='p1';
			INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Allowed',1);
			INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1);
			INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','member')`)
    const url = new URL('https://front.example/projects?includeArchived=true')
    const run = runWithDatabase(database, url, (scope) => renderProjects(scope, url))
    const node = await run.result
    if (!isValidElement<ComponentProps<typeof ProjectList>>(node)) throw new Error('Expected project list')
    expect(node.props.initialProjects.map((project) => project.id)).toEqual(['p1'])
    expect(run.transport).toHaveBeenCalledTimes(0)
  })
  it('maps the camelCase project model and canonical recent issue/wiki/flow DTOs without API reads', async () => {
    const database = featureDatabase()
    database.sqlite.exec(`UPDATE projects SET description='From actual D1' WHERE id='p1';
			INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at) VALUES
			('i1','w1','p1',1,'Old issue','u1',1,1), ('i2','w1','p1',2,'Recent issue','u1',2,20),
			('hidden','w2','foreign',1,'Private issue','u1',99,99);
			INSERT INTO wiki_pages (id,workspace_id,project_id,slug,title,created_by_id,updated_by_id,created_at,updated_at) VALUES
			('page1','w1','p1','old','Old page','u1','u1',1,1), ('page2','w1','p1','recent','Recent page','u1','u1',2,20),
			('private','w2','foreign','private','Private page','u1','u1',99,99)`)
    const url = new URL('https://front.example/projects/view?projectId=p1&workspace=alpha')
    const run = runWithDatabase(database, url, (scope) => renderOverview(scope, url))
    const node = await run.result
    if (!isValidElement<ComponentProps<typeof ProjectLanding>>(node)) throw new Error('Expected project landing')
    expect(node.props.initialProject).toEqual({
      id: 'p1',
      workspaceId: 'w1',
      name: 'Project',
      key: 'PROJ',
      slug: 'project',
      description: 'From actual D1',
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
    })
    expect(node.props.initialIssues.map((issue) => issue.id)).toEqual(['i2', 'i1'])
    expect(node.props.initialWiki.map((page) => page.id)).toEqual(['page2', 'page1'])
    expect(node.props.initialFlow?.throughputOverTime).toHaveLength(6)
    expect(node.props.workspaceSlug).toBe('alpha')
    expect(run.transport).toHaveBeenCalledTimes(0)
  })
  it('rejects a selection absent from the authorized catalog before overview queries', async () => {
    const database = featureDatabase()
    const url = new URL('https://front.example/projects/view?projectId=p1')
    await expect(
      runWithDatabase(database, url, (scope) => renderOverview({ ...scope, projects: [] }, url)).result,
    ).rejects.toMatchObject({ _tag: 'ScopeError', status: 404 })
  })
  it('keeps database errors private instead of synthesizing an HTTP response', async () => {
    const database = featureDatabase()
    const url = new URL('https://front.example/projects/view?projectId=p1')
    await expect(
      runWithDatabase(database, url, (scope) => {
        database.sqlite.exec('DROP TABLE task_types')
        return renderOverview(scope, url)
      }).result,
    ).rejects.toMatchObject({
      _tag: 'ApiError',
      status: 500,
      message: 'Unable to load project data.',
    })
  })
})
