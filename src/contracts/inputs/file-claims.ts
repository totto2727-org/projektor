import { z } from 'zod'

import { BooleanQueryParam } from './common.ts'

const MAX_PATH_LENGTH = 400
const MAX_CLAIM_PATHS = 100

export const ClaimFilesSchema = z.object({
  issueId: z.uuid(),
  agentId: z.uuid().optional(),
  paths: z.array(z.string().nonempty().max(MAX_PATH_LENGTH)).nonempty().max(MAX_CLAIM_PATHS),
  force: z.boolean().optional(),
})

export const ReleaseFilesSchema = z.object({
  paths: z.array(z.string()).nonempty(),
  issueId: z.uuid().optional(),
})

/*
 * PROJ-932: projectId accepts a UUID or a project key, resolved the same way list_issues
 * resolves its projectId filter. includeStale restores the pre-PROJ-932 behaviour of
 * returning every unreleased claim regardless of holder health.
 */
export const ListFileClaimsSchema = z.object({
  issueId: z.uuid().optional(),
  path: z.string().optional(),
  projectId: z.string().optional(),
  includeStale: BooleanQueryParam.optional(),
})
