import { String, Iterable, Predicate, Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import type { ReviewFilter, ReviewStatus } from '#contracts/review-targets.ts'
import { runTestEffect, runInOrder } from '#tests/run-effect.ts'
import { issueDataFixture } from '@/features/issues/test/data-fixture.ts'
import { scope, workspace } from '@/features/issues/test/fixtures.ts'

import { readDataIssuePage, searchDataIssues } from './issue-data.ts'
import { CoreReadServices } from './read-services.ts'

const databases: ReturnType<typeof issueDataFixture>[] = []

const fixture = function fixture() {
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
  for (let index = 0; index < 35; index += 1) {
    const id = `active-${globalThis.String(index).padStart(2, '0')}`
    const projectId = index % 2 === 0 ? 'project-a' : 'project-b'
    const status = states[index % states.length] ?? 'fixing'
    database.insertIssue({ id, projectId, number: 100 + index, title: 'Needle review target', createdAt: index + 100 })
    attach(id, status)
    selected.push({ id, projectId, status })
  }
  for (let index = 0; index < 25; index += 1) {
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
  const run = function run<A, E>(operation: Effect.Effect<A, E, CoreReadServices>): Promise<A> {
    return runTestEffect(operation.pipe(Effect.provideService(CoreReadServices, { db: database.db })))
  }
  const page = (params: string) => run(readDataIssuePage(scope, workspace.id, new URLSearchParams(params)))
  const search = (review?: ReviewFilter, projectId?: string) =>
    run(searchDataIssues(scope, workspace.id, 'Needle', projectId, review))
  return { ...database, selected, page, search, run }
}

describe('cross-project review filters at the Core data boundary', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test('filters before counts and cursor pagination across more than one page without leaking hidden or foreign issues', async () => {
    const testFixture = fixture()
    const seen: string[] = []
    let cursor: string | null | undefined
    do {
      const params = new URLSearchParams({ review: 'active', limit: '7' })
      if (Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor)) {
        params.set('cursor', cursor)
      }
      const page = await testFixture.page(params.toString())
      expect(page.total).toBe(Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor) ? null : 35)
      expect(page.items).toHaveLength(7)
      seen.push(...page.items.map((row) => row.id))
      cursor = Predicate.isString(page.nextCursor) ? page.nextCursor : null
    } while (Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor))
    expect(seen).toStrictEqual(testFixture.selected.map((entry) => entry.id).reverse())
    expect(new Set(seen).size).toBe(35)
  })

  test.each(['fixing', 'in_review', 'changes_requested'] as const)(
    'matches %s targets across authorized projects and preserves search parity',
    async (review) => {
      const testFixture = fixture()
      const expected = testFixture.selected
        .filter((entry) => entry.status === review)
        .map((entry) => entry.id)
        .toSorted()
      const page = await testFixture.page(`review=${review}&limit=100`)
      expect(page.total).toBe(expected.length)
      expect(page.items.map((entry) => entry.id).toSorted()).toStrictEqual(expected)
      const result = await testFixture.search(review)
      expect(result.map((entry) => entry.id).toSorted()).toStrictEqual(expected)
    },
  )

  test('applies review filtering before the FTS result limit despite higher-ranked unselected hits', async () => {
    const testFixture = fixture()
    const rows = await testFixture.search('active')
    expect(rows).toHaveLength(20)
    expect(rows.every((row) => testFixture.selected.some((entry) => entry.id === row.id))).toBe(true)
    expect(new Set(rows.map((row) => row.project_id))).toStrictEqual(new Set(['project-a', 'project-b']))
  })

  test('intersects explicit project selection and review filters', async () => {
    const testFixture = fixture()
    const expected = testFixture.selected
      .filter((entry) => entry.projectId === 'project-b')
      .map((entry) => entry.id)
      .toSorted()
    const page = await testFixture.page('review=active&project=project-b&limit=100')
    expect(page.total).toBe(expected.length)
    expect(page.items.map((row) => row.id).toSorted()).toStrictEqual(expected)
    const result = await testFixture.search('active', 'project-b')
    expect(result.map((row) => row.id).toSorted()).toStrictEqual(expected)
  })

  test('does not multiply issue counts when multiple attachments match the same filter', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(`INSERT INTO attachments
      (id,workspace_id,kind,r2_key,filename,content_type,size,review_status,entity_type,entity_id,created_by_id,created_at)
      VALUES ('second-target','workspace-a','file','w/file','Spec','text/plain',1,'fixing','issue','active-00','user-a',1)`)
    const result = await testFixture.page('review=active&limit=100')
    expect(result.total).toBe(35)
    const resolvedValue = await testFixture.page('review=fixing&limit=100')
    expect(resolvedValue.items.filter((row) => row.id === 'active-00')).toHaveLength(1)
  })

  test('rejects invalid review filters at the Core boundary rather than ignoring them', async () => {
    expect.hasAssertions()
    const testFixture = fixture()
    await runInOrder(['done', 'invalid', ''], async (review): Promise<void> => {
      await expect(testFixture.page(`review=${review}`)).rejects.toMatchObject({ status: 400 })
    })
    await expect(testFixture.page('review=active&review=fixing')).rejects.toMatchObject({ status: 400 })
  })

  test('preserves unfiltered list and search behavior when review is omitted', async () => {
    const testFixture = fixture()
    const resolvedValue = await testFixture.page('limit=100')
    expect(resolvedValue.total).toBe(62)
    const result = await testFixture.search()
    expect(result.some((row) => row.id.startsWith('unselected-'))).toBe(true)
  })
})
