import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import type { ReviewFilter, ReviewStatus } from '../../contracts/review-targets'
import { issueDataFixture } from '../../web/features/issues/test/data-fixture'
import { scope, workspace } from '../../web/features/issues/test/fixtures'
import { readDataIssuePage, searchDataIssues } from './issue-data'
import { CoreReadServices } from './read-services'

const databases: ReturnType<typeof issueDataFixture>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = issueDataFixture()
  databases.push(database)
  const selected: { id: string; projectId: string; status: ReviewStatus }[] = []
  const states = ['fixing', 'in_review', 'changes_requested'] as const
  const attach = (id: string, status: ReviewStatus | null, workspaceId = workspace.id) =>
    database.sqlite
      .prepare(`INSERT INTO attachments
    (id,workspace_id,kind,r2_key,filename,content_type,size,url,review_status,entity_type,entity_id,created_by_id,created_at)
    VALUES (?,?,'url','','Design','',0,'https://example.test',?,'issue',?,'user-a',1)`)
      .run(`attachment-${id}`, workspaceId, status, id)
  for (let index = 0; index < 35; index++) {
    const id = `active-${String(index).padStart(2, '0')}`
    const projectId = index % 2 === 0 ? 'project-a' : 'project-b'
    const status = states[index % states.length] ?? 'fixing'
    database.insertIssue({ id, projectId, number: 100 + index, title: 'Needle review target', createdAt: index + 100 })
    attach(id, status)
    selected.push({ id, projectId, status })
  }
  for (let index = 0; index < 25; index++) {
    const id = `unselected-${index}`
    database.insertIssue({ id, number: 200 + index, title: 'Needle', createdAt: 1000 + index })
    attach(id, index % 2 === 0 ? null : 'done')
  }
  database.insertIssue({
    id: 'selected-hidden',
    projectId: 'hidden-project',
    number: 100,
    title: 'Needle hidden',
    createdAt: 2000,
  })
  attach('selected-hidden', 'in_review')
  database.insertIssue({
    id: 'selected-other',
    workspaceId: 'workspace-b',
    projectId: 'other-project',
    number: 100,
    title: 'Needle foreign',
    createdAt: 2000,
  })
  attach('selected-other', 'in_review', 'workspace-b')
  attach('issue-a', 'in_review', 'workspace-b')
  function run<A, E>(operation: Effect.Effect<A, E, CoreReadServices>) {
    return Effect.runPromise(operation.pipe(Effect.provideService(CoreReadServices, { db: database.db })))
  }
  const page = (params: string) => run(readDataIssuePage(scope, workspace.id, new URLSearchParams(params)))
  const search = (review?: ReviewFilter, projectId?: string) =>
    run(searchDataIssues(scope, workspace.id, 'Needle', projectId, review))
  return { ...database, selected, page, search, run }
}

describe('cross-project review filters at the Core data boundary', () => {
  it('filters before counts and cursor pagination across more than one page without leaking hidden or foreign issues', async () => {
    const f = fixture()
    const seen: string[] = []
    let cursor: string | null | undefined
    do {
      const params = new URLSearchParams({ review: 'active', limit: '7' })
      if (cursor) params.set('cursor', cursor)
      const page = await f.page(params.toString())
      expect(page.total).toBe(cursor ? null : 35)
      expect(page.items).toHaveLength(7)
      seen.push(...page.items.map((row) => row.id))
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null
    } while (cursor)
    expect(seen).toEqual(f.selected.map((entry) => entry.id).reverse())
    expect(new Set(seen).size).toBe(35)
  })

  it.each(['fixing', 'in_review', 'changes_requested'] as const)(
    'matches %s targets across authorized projects and preserves search parity',
    async (review) => {
      const f = fixture()
      const expected = f.selected
        .filter((entry) => entry.status === review)
        .map((entry) => entry.id)
        .sort()
      const page = await f.page(`review=${review}&limit=100`)
      expect(page.total).toBe(expected.length)
      expect(page.items.map((entry) => entry.id).sort()).toEqual(expected)
      expect((await f.search(review)).map((entry) => entry.id).sort()).toEqual(expected)
    },
  )

  it('applies review filtering before the FTS result limit despite higher-ranked unselected hits', async () => {
    const f = fixture()
    const rows = await f.search('active')
    expect(rows).toHaveLength(20)
    expect(rows.every((row) => f.selected.some((entry) => entry.id === row.id))).toBe(true)
    expect(new Set(rows.map((row) => row.project_id))).toEqual(new Set(['project-a', 'project-b']))
  })

  it('intersects explicit project selection and review filters', async () => {
    const f = fixture()
    const expected = f.selected
      .filter((entry) => entry.projectId === 'project-b')
      .map((entry) => entry.id)
      .sort()
    const page = await f.page('review=active&project=project-b&limit=100')
    expect(page.total).toBe(expected.length)
    expect(page.items.map((row) => row.id).sort()).toEqual(expected)
    expect((await f.search('active', 'project-b')).map((row) => row.id).sort()).toEqual(expected)
  })

  it('does not multiply issue counts when multiple attachments match the same filter', async () => {
    const f = fixture()
    f.sqlite.exec(`INSERT INTO attachments
      (id,workspace_id,kind,r2_key,filename,content_type,size,review_status,entity_type,entity_id,created_by_id,created_at)
      VALUES ('second-target','workspace-a','file','w/file','Spec','text/plain',1,'fixing','issue','active-00','user-a',1)`)
    expect((await f.page('review=active&limit=100')).total).toBe(35)
    expect((await f.page('review=fixing&limit=100')).items.filter((row) => row.id === 'active-00')).toHaveLength(1)
  })

  it('rejects invalid review filters at the Core boundary rather than ignoring them', async () => {
    const f = fixture()
    for (const review of ['done', 'invalid', '']) {
      await expect(f.page(`review=${review}`)).rejects.toMatchObject({ status: 400 })
    }
    await expect(f.page('review=active&review=fixing')).rejects.toMatchObject({ status: 400 })
  })

  it('preserves unfiltered list and search behavior when review is omitted', async () => {
    const f = fixture()
    expect((await f.page('limit=100')).total).toBe(62)
    expect((await f.search()).some((row) => row.id.startsWith('unselected-'))).toBe(true)
  })
})
