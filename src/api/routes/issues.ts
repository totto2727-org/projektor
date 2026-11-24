import { Predicate } from 'effect'
import { Hono } from 'hono'

import { jsonBody } from '#api/http/body.ts'
import { serviceErrToResponse } from '#api/http/error-adapter.ts'
import { claimIssue, listIssueLeases, releaseIssue } from '#api/services/issue-leases.ts'
import {
  createIssue,
  deleteIssue,
  getIssue,
  getIssuesBatch,
  getPrioritizedIssues,
  listIssues,
  searchIssues,
  updateIssue,
} from '#api/services/issues.ts'
import { ctxFromHono } from '#api/services/types.ts'
import { ISSUE_REF_PATTERN } from '#contracts/issue-ref.ts'
import type { HonoEnv } from '#types'

const router = new Hono<HonoEnv>()

router.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const {
    status,
    statusId,
    statusIds,
    category,
    priority,
    priorities,
    project: projectId,
    assignee,
    parentId,
    noParent,
    typeId,
    excludeTypeIds,
    sprintId,
    cfKey,
    cfOp,
    cfValue,
    completedAfter,
    completedBefore,
    updatedAfter,
    updatedBefore,
    needsAudit,
    includeRollups,
    includeBody,
    cursor,
    limit,
  } = httpContext.req.query()
  try {
    return httpContext.json(
      await listIssues(ctx, {
        status,
        statusId,
        statusIds,
        category,
        priority,
        priorities,
        projectId,
        assignee,
        parentId,
        noParent,
        typeId,
        excludeTypeIds,
        sprintId,
        cfKey,
        cfOp,
        cfValue,
        completedAfter,
        completedBefore,
        updatedAfter,
        updatedBefore,
        needsAudit,
        includeRollups,
        includeBody,
        cursor,
        limit,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/prioritized', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { limit, includeBacklog, excludeClaimed, includeNotReady, projectId } = httpContext.req.query()
  try {
    return httpContext.json(
      await getPrioritizedIssues(ctx, {
        limit: Predicate.isNotNullish(limit) ? Number(limit) : undefined,
        includeBacklog: Predicate.isNotNullish(includeBacklog) ? includeBacklog !== 'false' : undefined,
        excludeClaimed: Predicate.isNotNullish(excludeClaimed) ? excludeClaimed === 'true' : undefined,
        includeNotReady: Predicate.isNotNullish(includeNotReady) ? includeNotReady === 'true' : undefined,
        projectId,
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/search', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { q, projectId, limit } = httpContext.req.query()
  try {
    return httpContext.json(await searchIssues(ctx, { query: q, projectId, limit: limit ? Number(limit) : undefined }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// PROJ-931: batch fetch for triage (MCP: get_issues). Registered before "/:id" so
// "batch" is never captured as an issue id/ref.
router.get('/batch', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { refs, ids, includeBody } = httpContext.req.query()
  try {
    return httpContext.json(await getIssuesBatch(ctx, { refs, ids, includeBody }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const param = httpContext.req.param('id')
  // Accept KEY-NUMBER refs (e.g. PROJ-42) as well as UUIDs
  const input = ISSUE_REF_PATTERN.test(param) ? { ref: param } : { id: param }
  try {
    return httpContext.json(await getIssue(ctx, input))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await createIssue(ctx, await jsonBody(httpContext)), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// Note: PATCH now accepts `assigneeId` (camelCase) instead of `assignee_id`.
router.patch('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateIssue(ctx, httpContext.req.param('id'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:id', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteIssue(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// Issue leasing for parallel agents (PROJ-184)
router.post('/:id/claim', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const body = (await jsonBody(httpContext).catch(() => ({}))) as { agentId?: string }
  try {
    return httpContext.json(await claimIssue(ctx, { issueId: httpContext.req.param('id'), agentId: body.agentId }), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/:id/release', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const body = (await jsonBody(httpContext).catch(() => ({}))) as { agentId?: string }
  try {
    return httpContext.json(await releaseIssue(ctx, { issueId: httpContext.req.param('id'), agentId: body.agentId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:id/leases', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { includeStale } = httpContext.req.query()
  try {
    return httpContext.json(await listIssueLeases(ctx, { issueId: httpContext.req.param('id'), includeStale }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as issuesRouter }
