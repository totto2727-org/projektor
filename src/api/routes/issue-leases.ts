import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { serviceErrToResponse } from '../http/error-adapter.ts'
import { listIssueLeases } from '../services/issue-leases.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

// PROJ-932: workspace-wide REST parity for MCP's list_issue_leases. GET /api/issues/:id/leases
// (routes/issues.ts) stays as the single-issue view; this is the equivalent of
// /api/file-claims and /api/agents for leases.
router.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const { issueId, agentId, projectId, includeStale } = httpContext.req.query()
  try {
    return httpContext.json(await listIssueLeases(ctx, { issueId, agentId, projectId, includeStale }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as issueLeasesRouter }
