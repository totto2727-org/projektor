import { Effect } from 'effect'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { configureCore, env } from '../../src/api/test/fixture-api'
import type { ReviewFilter, ReviewStatus } from '../../src/contracts/review-targets'
import { SearchResultsSchema } from '../../src/contracts/web-schemas/issue-actions'
import { IssuePageSchema } from '../../src/contracts/web-schemas/issues'
import type { WebRequest } from '../../src/core/web/scope'

let request: WebRequest
let workspaceId: string
let foreignWorkspaceId: string
let firstProject: string
let secondProject: string
let hiddenProject: string
let groupId: string
let selected: { id: string; projectId: string; status: ReviewStatus }[]

beforeEach(async () => {
  const suffix = crypto.randomUUID()
  const userId = `filter-user-${suffix}`
  const email = `filter-${suffix}@example.test`
  const slug = `filter-${suffix}`
  workspaceId = `filter-workspace-${suffix}`
  foreignWorkspaceId = `foreign-workspace-${suffix}`
  firstProject = `first-${suffix}`
  secondProject = `second-${suffix}`
  hiddenProject = `hidden-${suffix}`
  const foreignProject = `foreign-${suffix}`
  groupId = `filter-group-${suffix}`
  await configureCore({ DEV_USER_EMAIL: email, DEFAULT_WORKSPACE_SLUG: slug })
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id,email,name,created_at) VALUES (?,?,'Reviewer',1)").bind(userId, email),
    env.DB.prepare("INSERT INTO workspaces (id,name,slug,created_at) VALUES (?,'Review',?,1),(?,'Other',?,1)").bind(
      workspaceId,
      slug,
      foreignWorkspaceId,
      `other-${suffix}`,
    ),
    env.DB.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,'member',1)").bind(
      workspaceId,
      userId,
    ),
    env.DB.prepare(
      "INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES (?,?,'First','ONE',1,1),(?,?,'Second','TWO',1,1),(?,?,'Hidden','HID',1,1),(?,?,'Foreign','OTH',1,1)",
    ).bind(
      firstProject,
      workspaceId,
      secondProject,
      workspaceId,
      hiddenProject,
      workspaceId,
      foreignProject,
      foreignWorkspaceId,
    ),
    env.DB.prepare("INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES (?,?,'Visible',1)").bind(
      groupId,
      workspaceId,
    ),
    env.DB.prepare('INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES (?,?,?,1)').bind(
      groupId,
      userId,
      userId,
    ),
    env.DB.prepare(
      "INSERT INTO group_project_grants (group_id,project_id,role) VALUES (?,?,'member'),(?,?,'member')",
    ).bind(groupId, firstProject, groupId, secondProject),
  ])
  const statements: D1PreparedStatement[] = []
  selected = []
  const states = ['fixing', 'in_review', 'changes_requested'] as const
  for (let index = 0; index < 62; index++) {
    const active = index < 35
    const ownerWorkspace = index === 61 ? foreignWorkspaceId : workspaceId
    const projectId =
      index === 60 ? hiddenProject : index === 61 ? foreignProject : index % 2 === 0 ? firstProject : secondProject
    const id = `filter-issue-${suffix}-${String(index).padStart(2, '0')}`
    const status = active
      ? (states[index % 3] ?? 'fixing')
      : index >= 60
        ? 'in_review'
        : index % 2 === 0
          ? null
          : 'done'
    const title = active ? 'Needle review target' : 'Needle'
    const createdAt = index + 100
    statements.push(
      env.DB.prepare(
        "INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at) VALUES (?,?,?,?,?,'todo','medium',?,?,?)",
      ).bind(id, ownerWorkspace, projectId, index + 1, title, userId, createdAt, createdAt),
    )
    statements.push(
      env.DB.prepare('INSERT INTO issues_fts (issue_id,workspace_id,title,body) VALUES (?,?,?,?)').bind(
        id,
        ownerWorkspace,
        title,
        '',
      ),
    )
    statements.push(
      env.DB.prepare(
        "INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,review_status,entity_type,entity_id,created_by_id,created_at) VALUES (?,?,'url','','Design','',0,'https://example.test',?,'issue',?,?,1)",
      ).bind(`target-${id}`, ownerWorkspace, status, id, userId),
    )
    if (active && status) selected.push({ id, projectId, status })
  }
  statements.push(
    env.DB.prepare(
      "INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,review_status,entity_type,entity_id,created_by_id,created_at) VALUES (?,?,'file','foreign/key','Foreign','text/plain',1,'in_review','issue',?,?,1)",
    ).bind(`cross-workspace-target-${suffix}`, foreignWorkspaceId, `filter-issue-${suffix}-35`, userId),
  )
  for (let offset = 0; offset < statements.length; offset += 75)
    await env.DB.batch(statements.slice(offset, offset + 75))
  request = { url: `https://front.test/issues?workspace=${slug}`, method: 'GET', headers: [] }
})

function page(query: string, workspace = workspaceId) {
  return Effect.runPromise(
    decodeCoreReply(IssuePageSchema, makeCoreClient(Reflect.get(env, 'CORE')).webIssuePage(request, workspace, query)),
  )
}
function search(review?: ReviewFilter, projectId?: string, workspace = workspaceId) {
  return Effect.runPromise(
    decodeCoreReply(
      SearchResultsSchema,
      makeCoreClient(Reflect.get(env, 'CORE')).webIssueSearch(request, workspace, 'Needle', projectId, review),
    ),
  )
}

describe('cross-project review filters through actual named Core bindings', () => {
  it('counts all filtered visible issues and pages them without unselected or hidden leaks', async () => {
    const seen: string[] = []
    let cursor: string | null | undefined
    do {
      const query = new URLSearchParams({ review: 'active', limit: '7' })
      if (cursor) query.set('cursor', cursor)
      const result = await page(query.toString())
      expect(result.total).toBe(cursor ? null : 35)
      expect(result.items).toHaveLength(7)
      seen.push(...result.items.map((row) => row.id))
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null
    } while (cursor)
    expect(seen).toEqual(selected.map((row) => row.id).reverse())
  })

  it.each(['fixing', 'in_review', 'changes_requested'] as const)(
    'uses the same %s filter for list and native FTS search across projects',
    async (review) => {
      const expected = selected
        .filter((row) => row.status === review)
        .map((row) => row.id)
        .sort()
      const result = await page(`review=${review}&limit=100`)
      expect(result.total).toBe(expected.length)
      expect(result.items.map((row) => row.id).sort()).toEqual(expected)
      expect((await search(review)).map((row) => row.id).sort()).toEqual(expected)
    },
  )

  it('applies active review selection before the native FTS result limit', async () => {
    const rows = await search('active')
    expect(rows).toHaveLength(20)
    expect(rows.every((row) => selected.some((entry) => entry.id === row.id))).toBe(true)
    expect(new Set(rows.map((row) => row.project_id))).toEqual(new Set([firstProject, secondProject]))
  })

  it('intersects selected project filters and denies ungranted projects and foreign workspaces', async () => {
    const expected = selected
      .filter((row) => row.projectId === secondProject)
      .map((row) => row.id)
      .sort()
    expect((await page(`review=active&project=${secondProject}&limit=100`)).items.map((row) => row.id).sort()).toEqual(
      expected,
    )
    expect((await search('active', secondProject)).map((row) => row.id).sort()).toEqual(expected)
    await expect(page(`review=active&project=${hiddenProject}`)).rejects.toMatchObject({ status: 404 })
    await expect(search('active', hiddenProject)).rejects.toMatchObject({ status: 404 })
    await expect(page('review=active', foreignWorkspaceId)).rejects.toMatchObject({ status: 403 })
    await expect(search('active', undefined, foreignWorkspaceId)).rejects.toMatchObject({ status: 403 })
  })

  it('rechecks revoked project grants in filtered counts and search results on the next invocation', async () => {
    await env.DB.prepare('DELETE FROM group_project_grants WHERE group_id=? AND project_id=?')
      .bind(groupId, secondProject)
      .run()
    const expected = selected
      .filter((row) => row.projectId === firstProject)
      .map((row) => row.id)
      .sort()
    const result = await page('review=active&limit=100')
    expect(result.total).toBe(expected.length)
    expect(result.items.map((row) => row.id).sort()).toEqual(expected)
    expect((await search('active')).map((row) => row.id).sort()).toEqual(expected)
  })

  it('rejects malformed review query values at the native Core boundary', async () => {
    for (const review of ['done', 'invalid', ''])
      await expect(page(`review=${review}`)).rejects.toMatchObject({ status: 400 })
  })
})
