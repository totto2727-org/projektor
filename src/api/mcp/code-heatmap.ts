import { getCodeHeatmap } from '#api/services/code-heatmap.ts'

import { READ } from './annotations.ts'
import { requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const codeHeatmapTools: MCPTool[] = [
  {
    annotations: READ,
    description:
      'Where work lands in the codebase, from file-claim history — no git ' +
      'integration needed. Aggregates claims one path segment below `prefix` (omit for the ' +
      'top level), sized by distinctIssueCount (distinct issues that claimed a path under that ' +
      'segment, claimedAt within [since, until]) plus claimCount (raw claim count, including ' +
      "released ones). Each entry's `path` is the drill-down cursor: re-call with `prefix` set " +
      "to it to see what's under a directory; `isLeaf` marks an entry that is itself a claimed " +
      'file path, not a directory. Defaults to the current ISO week plus the preceding 5 weeks, ' +
      'matching get_flow_metrics. `mode` switches sizing between claim volume and claim ' +
      'contention (claim_conflicts).',
    async handler(input, ctx) {
      return getCodeHeatmap(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId'], {
      projectId: describedInputProperty('string', 'Project UUID'),
      since: describedInputProperty('number', 'Only claims claimed at/after this epoch-seconds time'),
      until: describedInputProperty('number', 'Only claims claimed at/before this epoch-seconds time'),
      prefix: describedInputProperty('string', 'Directory path to drill into; omit for the top-level segments'),
      mode: {
        type: 'string',
        enum: ['claims', 'contention'],
        description:
          '"claims" (default) sizes by file-claim volume; "contention" sizes by ' +
          'claim_conflicts — rejected/overridden claimFiles attempts, i.e. where the fleet ' +
          'queued up.',
      },
    }),
    name: 'get_code_heatmap',
  },
]
