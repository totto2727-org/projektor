import { Effect } from 'effect'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { RequestServices } from '../../request'
import type { RequestScope } from '../../server/request-context'
import { createTestDatabase } from '../../test/database'
import { testRequestApi } from '../wiki/test-api'
import { renderFeedback, renderFeedbackDetail } from './server'

vi.mock('./actions', () => ({}))
const workspace = { id: 'workspace', name: 'Team', slug: 'team', role: 'owner' as const }
const project = {
  id: 'actual',
  key: 'ACT',
  name: 'Actual',
  slug: null,
  description: null,
  workspace_id: 'workspace',
  workspace_name: 'Team',
  workspace_slug: 'team',
  open_issue_count: 0,
  backlog_issue_count: 0,
  archived_at: null,
  created_at: 1,
  updated_at: 1,
}
const scope: RequestScope = {
  user: { id: 'user', name: 'Alice', email: 'alice@example.test' },
  workspaces: [workspace],
  projects: [project],
  selection: { kind: 'workspace', workspace },
}
const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
function fixture(currentScope = scope) {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
		INSERT INTO users (id,email,name,created_at) VALUES ('user','alice@example.test','Alice',1);
		INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace','Team','team',1),('foreign','Foreign','foreign',1);
		INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace','user','owner',1);
		INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('actual','workspace','Actual','ACT',1,1),('outside','workspace','Outside','OUT',1,1),('foreign-project','foreign','Private','PRIV',1,1);
		INSERT INTO feedback_sources (id,token_hash,workspace_id,project_id,name,description,is_active,allowed_origins,created_by,created_at) VALUES
			('source','0123456789abcdef-secret','workspace','actual','Customer feedback','Tell us',1,'["https://example.test"]','user',1),
			('hidden','hiddenhash','workspace','outside','Hidden source',NULL,1,NULL,'user',1),
			('foreign-source','foreignhash','foreign','foreign-project','Private source',NULL,1,NULL,'user',1);
		INSERT INTO feedback (id,source_id,workspace_id,project_id,rating,rating_scale,body,app_version,status,created_at) VALUES
			('row','source','workspace','actual',5,'five_star','Useful customer comment','v1','new',1),
			('reviewed','source','workspace','actual',1,'thumbs','Reviewed comment','v2','reviewed',2);
	`)
  const execute = vi.fn(() => Effect.die('Feedback reads must not call HTTP'))
  const api = testRequestApi(execute)
  const request = new Request('https://app.test/feedback')
  const services = {
    api,
    request,
    env: { API_BASE: 'https://api.test', DB: database.db },
    db: database.db,
    url: new URL(request.url),
    scope: () => Effect.succeed(currentScope),
    prepare: <T,>(view: T) => view,
    invalidate: Effect.void,
  }
  function run<T, E>(effect: Effect.Effect<T, E, RequestServices>) {
    return Effect.runPromise(effect.pipe(Effect.provideService(RequestServices, services)))
  }
  return { ...database, api, execute, run }
}

describe('feedback request-local database SSR', () => {
  it('requires a project for grid without reading API or DB', async () => {
    const f = fixture()
    const prepare = vi.spyOn(f.db, 'prepare')
    expect(
      renderToStaticMarkup(await f.run(renderFeedback(f.api, scope, new URL('https://app.test/feedback')))),
    ).toContain('Choose a project')
    expect(prepare).not.toHaveBeenCalled()
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('derives source project independently of URL and preserves canonical DTOs without exposing credentials', async () => {
    const f = fixture()
    const node = await f.run(
      renderFeedbackDetail(
        f.api,
        scope,
        new URL('https://app.test/feedback/view?sourceId=source&projectId=wrong&status=new&tab=summary'),
      ),
    )
    expect(node.props.projectId).toBe('actual')
    expect(node.props.initialStatus).toBe('new')
    expect(node.props.initialTab).toBe('summary')
    expect(node.props.initialRows.map((row: { id: string }) => row.id)).toEqual(['row'])
    expect(node.props.initialSource).toMatchObject({
      isActive: true,
      allowedOrigins: ['https://example.test'],
      tokenPreview: '0123456789ab…',
    })
    expect(node.props.initialSummary).toMatchObject({
      totalCount: 2,
      versions: [
        { appVersion: 'v2', thumbsUpPct: 100, avgFiveStar: null },
        { appVersion: 'v1', avgFiveStar: 5, thumbsUpPct: null },
      ],
    })
    expect(JSON.stringify(node.props)).not.toContain('abcdef-secret')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('checks source project catalog before loading protected sources or feedback', async () => {
    const f = fixture()
    const prepare = vi.spyOn(f.db, 'prepare')
    const node = await f.run(
      renderFeedbackDetail(f.api, scope, new URL('https://app.test/feedback'), {
        sourceId: 'hidden',
      }),
    )
    expect(renderToStaticMarkup(node)).toContain('Feedback source not found')
    expect(prepare).toHaveBeenCalledTimes(1)
  })
  it("does not resolve another workspace's source", async () => {
    const f = fixture()
    expect(
      renderToStaticMarkup(
        await f.run(renderFeedbackDetail(f.api, scope, new URL('https://app.test/feedback?id=foreign-source'))),
      ),
    ).toContain('Feedback source not found')
  })
  it('retains source-management admin policy before grid reads', async () => {
    const member = { ...workspace, role: 'member' as const }
    const memberScope: RequestScope = {
      ...scope,
      workspaces: [member],
      selection: { kind: 'project', workspace: member, project },
    }
    const f = fixture(memberScope)
    const prepare = vi.spyOn(f.db, 'prepare')
    await expect(f.run(renderFeedback(f.api, memberScope, new URL('https://app.test/feedback')))).rejects.toMatchObject(
      { _tag: 'ScopeError', status: 403 },
    )
    expect(prepare).not.toHaveBeenCalled()
  })
  it('rejects malformed URL status as a validation error', async () => {
    const f = fixture()
    await expect(
      f.run(renderFeedbackDetail(f.api, scope, new URL('https://app.test/feedback?id=source&status=unknown'))),
    ).rejects.toMatchObject({ _tag: 'ScopeError', status: 400 })
  })
  it('redacts malformed stored source metadata without exposing driver or credential details', async () => {
    const f = fixture()
    f.sqlite.prepare("UPDATE feedback_sources SET allowed_origins = ? WHERE id = 'source'").run('private invalid JSON')
    const result = await f.run(
      renderFeedback(
        f.api,
        { ...scope, selection: { kind: 'project', workspace, project } },
        new URL('https://app.test/feedback'),
      ).pipe(Effect.catch((error) => Effect.succeed(error))),
    )
    expect(result).toMatchObject({
      _tag: 'ApiError',
      status: 500,
      message: 'Unable to load project data.',
    })
    expect(JSON.stringify(result)).not.toContain('private invalid JSON')
  })
  it('renders original grid cards from DB initial DTOs', async () => {
    const f = fixture()
    const node = await f.run(
      renderFeedback(
        f.api,
        { ...scope, selection: { kind: 'project', workspace, project } },
        new URL('https://app.test/feedback'),
      ),
    )
    const html = renderToStaticMarkup(node)
    expect(html).toContain('Customer feedback')
    expect(html).toContain('2 total')
    expect(html).toContain('workspace=team')
  })
})
