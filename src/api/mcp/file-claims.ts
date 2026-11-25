import { claimFiles, listFileClaims, releaseFiles } from '#api/services/file-claims.ts'

import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const fileClaimsTools: MCPTool[] = [
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Claim one or more repo file paths for an issue so the parallel fleet can see what is taken',
    async handler(input, ctx) {
      return claimFiles(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['issueId', 'paths'], {
      issueId: describedInputProperty('string', 'Issue UUID to associate the claims with'),
      agentId: describedInputProperty('string', 'Agent session UUID claiming the files (optional)'),
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths to claim (1–100 paths, each max 400 chars)',
      },
      force: describedInputProperty('boolean', 'When true, steal claims held by other issues/agents (default: false)'),
    }),
    name: 'claim_files',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Release active file claims in the workspace, optionally scoped to an issue',
    async handler(input, ctx) {
      return releaseFiles(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['paths'], {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File paths to release',
      },
      issueId: describedInputProperty('string', 'Restrict release to claims held by this issue (optional)'),
    }),
    name: 'release_files',
  },
  {
    annotations: READ,
    description:
      'List active file claims in the workspace, optionally filtered by issue, path or project. ' +
      'Live entries only by default — a claim whose holder has ended, stopped heartbeating, or ' +
      '(for an agentless claim) sat past its TTL is excluded; pass includeStale:true for all. ' +
      'Each entry carries the linked issue\'s ref (e.g. "PROJ-857") as issueRef, and a `live` ' +
      'flag (false when the claim is reclaimable — only possible with includeStale:true).',
    async handler(input, ctx) {
      return listFileClaims(ctx, input)
    },
    inputSchema: objectInputSchema({
      issueId: describedInputProperty('string', 'Filter by issue UUID (optional)'),
      path: describedInputProperty(
        'string',
        'Filter by exact file path — shows who holds this file across issues (optional)',
      ),
      projectId: describedInputProperty(
        'string',
        'Filter to claims on issues in this project — UUID or project key (optional)',
      ),
      includeStale: describedInputProperty(
        'boolean',
        'Include claims whose holder has ended, gone stale, or (agentless) passed its TTL (default: false — live entries only)',
      ),
    }),
    name: 'list_file_claims',
  },
]
