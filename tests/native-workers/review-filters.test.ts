import { String, Predicate } from 'effect'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { configureCore, env } from '#api/test/fixture-api.ts'
import type { ReviewFilter, ReviewStatus } from '#contracts/review-targets.ts'
import { SearchResultsSchema } from '#contracts/web-schemas/issue-actions.ts'
import { IssuePageSchema } from '#contracts/web-schemas/issues.ts'
import type { WebRequest } from '#core/web/scope.ts'
import { runTestEffect, runInOrder } from '#tests/run-effect.ts'

interface ReviewQueries {
  page: (query: string, workspace?: string) => Promise<typeof IssuePageSchema.Type>
  search: (review?: ReviewFilter, projectId?: string, workspace?: string) => Promise<typeof SearchResultsSchema.Type>
}

interface ReviewFilterTestContext {
  reviewFixture: ReviewQueries & {
    firstProject: string
    foreignWorkspaceId: string
    groupId: string
    hiddenProject: string
    secondProject: string
    selected: { id: string; projectId: string; status: ReviewStatus }[]
  }
}

const createReviewQueries = function createReviewQueries(request: WebRequest, workspaceId: string): ReviewQueries {
  return {
    page(query, workspace = workspaceId) {
      return runTestEffect(
        decodeCoreReply(
          IssuePageSchema,
          makeCoreClient(Reflect.get(env, 'CORE')).webIssuePage(request, workspace, query),
        ),
      )
    },
    search(review, projectId, workspace = workspaceId) {
      return runTestEffect(
        decodeCoreReply(
          SearchResultsSchema,
          makeCoreClient(Reflect.get(env, 'CORE')).webIssueSearch(request, workspace, 'Needle', projectId, review),
        ),
      )
    },
  }
}

const verifyReviewFilter = async function verifyReviewFilter(
  { page, search, selected }: ReviewFilterTestContext['reviewFixture'],
  review: Exclude<ReviewFilter, 'active'>,
): Promise<void> {
  const expected = selected
    .filter((row) => row.status === review)
    .map((row) => row.id)
    .toSorted()
  const result = await page(`review=${review}&limit=100`)
  expect(result.total).toBe(expected.length)
  expect(result.items.map((row) => row.id).toSorted()).toStrictEqual(expected)
  const resolvedValue = await search(review)
  expect(resolvedValue.map((row) => row.id).toSorted()).toStrictEqual(expected)
}

describe('cross-project review filters through actual named Core bindings', () => {
  beforeEach<ReviewFilterTestContext>(async (context) => {
    const suffix = crypto.randomUUID()
    const userId = `filter-user-${suffix}`
    const email = `filter-${suffix}@example.test`
    const slug = `filter-${suffix}`
    const workspaceId = `filter-workspace-${suffix}`
    const foreignWorkspaceId = `foreign-workspace-${suffix}`
    const firstProject = `first-${suffix}`
    const secondProject = `second-${suffix}`
    const hiddenProject = `hidden-${suffix}`
    const foreignProject = `foreign-${suffix}`
    const groupId = `filter-group-${suffix}`
    await configureCore({ DEV_USER_EMAIL: email, DEFAULT_WORKSPACE_SLUG: slug })
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id,email,name,created_at) VALUES (?,?,'Reviewer',1)").bind(userId, email),
      env.DB.prepare("INSERT INTO workspaces (id,name,slug,created_at) VALUES (?,'Review',?,1),(?,'Other',?,1)").bind(
        workspaceId,
        slug,
        foreignWorkspaceId,
        `other-${suffix}`,
      ),
      env.DB.prepare(
        "INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,'member',1)",
      ).bind(workspaceId, userId),
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
    const selected: ReviewFilterTestContext['reviewFixture']['selected'] = []
    const states = ['fixing', 'in_review', 'changes_requested'] as const
    for (let index = 0; index < 62; index += 1) {
      const active = index < 35
      const ownerWorkspace = index === 61 ? foreignWorkspaceId : workspaceId
      const projectId =
        index === 60 ? hiddenProject : index === 61 ? foreignProject : index % 2 === 0 ? firstProject : secondProject
      const id = `filter-issue-${suffix}-${globalThis.String(index).padStart(2, '0')}`
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
      if (active && status) {
        selected.push({ id, projectId, status })
      }
    }
    statements.push(
      env.DB.prepare(
        "INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,review_status,entity_type,entity_id,created_by_id,created_at) VALUES (?,?,'file','foreign/key','Foreign','text/plain',1,'in_review','issue',?,?,1)",
      ).bind(`cross-workspace-target-${suffix}`, foreignWorkspaceId, `filter-issue-${suffix}-35`, userId),
    )
    for (let offset = 0; offset < statements.length; offset += 75) {
      await env.DB.batch(statements.slice(offset, offset + 75))
    }
    context.reviewFixture = {
      ...createReviewQueries(
        { url: `https://front.test/issues?workspace=${slug}`, method: 'GET', headers: [] },
        workspaceId,
      ),
      firstProject,
      foreignWorkspaceId,
      groupId,
      hiddenProject,
      secondProject,
      selected,
    }
  })

  test<ReviewFilterTestContext>('counts all filtered visible issues and pages them without unselected or hidden leaks', async ({
    reviewFixture: { page, selected },
  }) => {
    const seen: string[] = []
    let cursor: string | null | undefined
    do {
      const query = new URLSearchParams({ review: 'active', limit: '7' })
      if (Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor)) {
        query.set('cursor', cursor)
      }
      const result = await page(query.toString())
      expect(result.total).toBe(Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor) ? null : 35)
      expect(result.items).toHaveLength(7)
      seen.push(...result.items.map((row) => row.id))
      cursor = Predicate.isString(result.nextCursor) ? result.nextCursor : null
    } while (Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor))
    expect(seen).toStrictEqual(selected.map((row) => row.id).reverse())
  })

  test<ReviewFilterTestContext>('uses the same fixing filter for list and native FTS search across projects', async ({
    reviewFixture,
  }) => {
    expect.hasAssertions()
    await verifyReviewFilter(reviewFixture, 'fixing')
  })

  test<ReviewFilterTestContext>('uses the same in_review filter for list and native FTS search across projects', async ({
    reviewFixture,
  }) => {
    expect.hasAssertions()
    await verifyReviewFilter(reviewFixture, 'in_review')
  })

  test<ReviewFilterTestContext>('uses the same changes_requested filter for list and native FTS search across projects', async ({
    reviewFixture,
  }) => {
    expect.hasAssertions()
    await verifyReviewFilter(reviewFixture, 'changes_requested')
  })

  test<ReviewFilterTestContext>('applies active review selection before the native FTS result limit', async ({
    reviewFixture: { firstProject, search, secondProject, selected },
  }) => {
    const rows = await search('active')
    expect(rows).toHaveLength(20)
    expect(rows.every((row) => selected.some((entry) => entry.id === row.id))).toBe(true)
    expect(new Set(rows.map((row) => row.project_id))).toStrictEqual(new Set([firstProject, secondProject]))
  })

  test<ReviewFilterTestContext>('intersects selected project filters and denies ungranted projects and foreign workspaces', async ({
    reviewFixture: { foreignWorkspaceId, hiddenProject, page, search, secondProject, selected },
  }) => {
    const expected = selected
      .filter((row) => row.projectId === secondProject)
      .map((row) => row.id)
      .toSorted()
    const result = await page(`review=active&project=${secondProject}&limit=100`)
    expect(result.items.map((row) => row.id).toSorted()).toStrictEqual(expected)
    const resolvedValue = await search('active', secondProject)
    expect(resolvedValue.map((row) => row.id).toSorted()).toStrictEqual(expected)
    await expect(page(`review=active&project=${hiddenProject}`)).rejects.toMatchObject({ status: 404 })
    await expect(search('active', hiddenProject)).rejects.toMatchObject({ status: 404 })
    await expect(page('review=active', foreignWorkspaceId)).rejects.toMatchObject({ status: 403 })
    await expect(search('active', undefined, foreignWorkspaceId)).rejects.toMatchObject({ status: 403 })
  })

  test<ReviewFilterTestContext>('rechecks revoked project grants in filtered counts and search results on the next invocation', async ({
    reviewFixture: { firstProject, groupId, page, search, secondProject, selected },
  }) => {
    await env.DB.prepare('DELETE FROM group_project_grants WHERE group_id=? AND project_id=?')
      .bind(groupId, secondProject)
      .run()
    const expected = selected
      .filter((row) => row.projectId === firstProject)
      .map((row) => row.id)
      .toSorted()
    const result = await page('review=active&limit=100')
    expect(result.total).toBe(expected.length)
    expect(result.items.map((row) => row.id).toSorted()).toStrictEqual(expected)
    const resolvedValue = await search('active')
    expect(resolvedValue.map((row) => row.id).toSorted()).toStrictEqual(expected)
  })

  test<ReviewFilterTestContext>('rejects malformed review query values at the native Core boundary', async ({
    reviewFixture: { page },
  }) => {
    expect.hasAssertions()
    await runInOrder(['done', 'invalid', ''], async (review): Promise<void> => {
      await expect(page(`review=${review}`)).rejects.toMatchObject({ status: 400 })
    })
  })
})
