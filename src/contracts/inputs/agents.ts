import { z } from 'zod'

import { objectInOrder, BooleanQueryParam, StatusEnum } from './common.ts'
import { CompletionReportSchema } from './issues.ts'

const MAX_AGENT_NAME_LENGTH = 200
const MAX_PATH_LENGTH = 400
const MAX_START_WORK_PATHS = 100

export const RegisterAgentSchema = objectInOrder([
  ['issueId', z.uuid().optional()],
  ['name', z.string().nonempty().max(MAX_AGENT_NAME_LENGTH)],
  /*
   * PROJ-336: deprecated — accepted for MCP client compatibility but ignored by
   * the service (see services/agents.ts). It was the original spoofable
   * review-gate signal; PROJ-287 rebound the gate to live leases instead.
   */
  ['kind', z.enum(['agent', 'human']).optional()],
])

/*
 * PROJ-894: `id` may be omitted when the calling credential owns exactly one agent
 * session — see services/agent-identity.ts. Fleets sharing a credential must pass it.
 */
export const HeartbeatAgentSchema = z.object({
  id: z.uuid().optional(),
})

export const EndAgentSchema = z.object({
  id: z.uuid().optional(),
})

/*
 * PROJ-932: projectId accepts a UUID or a project key, resolved the same way list_issues
 * resolves its projectId filter. includeStale widens the default live-only filter to
 * every session in the workspace, including ended/stale ones.
 */
export const ListActiveAgentsSchema = objectInOrder([
  ['issueId', z.uuid().optional()],
  ['projectId', z.string().optional()],
  ['includeStale', BooleanQueryParam.optional()],
])

// PROJ-929: register + claim_issue + claim_files + post_message in one atomic call.
// `issue` (not `issueId`) and `name` match the AC's literal parameter names.
export const StartWorkSchema = objectInOrder([
  ['issue', z.uuid()],
  ['paths', z.array(z.string().nonempty().max(MAX_PATH_LENGTH)).max(MAX_START_WORK_PATHS).optional()],
  ['name', z.string().nonempty().max(MAX_AGENT_NAME_LENGTH)],
]).strict()

/*
 * PROJ-929: optionally transitions the issue via the existing update path (so
 * completion-report rules apply unchanged), then releases everything the session
 * holds and ends it — same effect as release_issue + release_files + end_agent.
 */
export const FinishWorkSchema = objectInOrder([
  ['sessionId', z.uuid()],
  ['issue', z.uuid()],
  ['completionReport', CompletionReportSchema.optional()],
  ['status', StatusEnum.optional()],
]).strict()
