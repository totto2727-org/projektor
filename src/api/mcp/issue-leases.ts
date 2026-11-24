import { claimIssue, listIssueLeases, releaseIssue } from '#api/services/issue-leases.ts'

import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const issueLeasesTools: MCPTool[] = [
  {
    annotations: IDEMPOTENT_WRITE,
    description:
      "Atomically lease an issue to an agent session so the parallel fleet doesn't double-work it. " +
      'Fails if another live session already holds it; reclaims a lease whose session stopped heartbeating.',
    handler(input, ctx) {
      return claimIssue(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['issueId'], {
      issueId: describedInputProperty('string', 'Issue UUID to lease'),
      agentId: describedInputProperty(
        'string',
        'Agent session UUID acquiring the lease (must be live). Optional when this credential has exactly one live session; fleets sharing a credential must pass it',
      ),
    }),
    name: 'claim_issue',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Release the active lease on an issue, optionally only if held by a given agent session',
    handler(input, ctx) {
      return releaseIssue(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['issueId'], {
      issueId: describedInputProperty('string', 'Issue UUID to release'),
      agentId: describedInputProperty('string', 'Only release if the lease is held by this agent session (optional)'),
    }),
    name: 'release_issue',
  },
  {
    annotations: READ,
    description:
      'List active issue leases in the workspace, optionally filtered by issue, agent or project. ' +
      'Live entries only by default — a lease whose agent session has ended or stopped ' +
      'heartbeating is excluded; pass includeStale:true for all. Each entry carries the linked ' +
      'issue\'s ref (e.g. "PROJ-857") as issueRef, and a `live` flag (false when the holder ' +
      'stopped heartbeating and the lease is reclaimable — only possible with includeStale:true).',
    handler(input, ctx) {
      return listIssueLeases(ctx, input)
    },
    inputSchema: objectInputSchema({
      issueId: describedInputProperty('string', 'Filter to leases on this issue (optional)'),
      agentId: describedInputProperty('string', 'Filter to leases held by this agent (optional)'),
      projectId: describedInputProperty(
        'string',
        'Filter to leases on issues in this project — UUID or project key (optional)',
      ),
      includeStale: describedInputProperty(
        'boolean',
        'Include leases whose agent session has ended or gone stale (default: false — live entries only)',
      ),
    }),
    name: 'list_issue_leases',
  },
]
