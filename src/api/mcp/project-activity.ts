import { listProjectActivity } from '#api/services/project-activity.ts'

import { READ } from './annotations.ts'
import { requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import { capPage, toPage } from './serialize.ts'
import type { MCPTool } from './types.ts'

export const projectActivityTools: MCPTool[] = [
  {
    annotations: READ,
    description:
      'List recent activity events for a project across issues, comments, wiki pages, and sprints. ' +
      'Returns `{items}` ordered most-recent first; a result over ~20,000 chars is cut to fit with ' +
      '`truncated:true` (lower `limit` or raise `since`). See /projektor/agents/response-conventions/.',
    async handler(input, ctx) {
      return capPage(toPage(await listProjectActivity(ctx, input)))
    },
    inputSchema: requiredObjectInputSchema(['projectId'], {
      projectId: describedInputProperty('string', 'The project UUID to fetch activity for'),
      since: describedInputProperty('number', 'Unix timestamp - only return events created at or after this time'),
      limit: {
        type: 'number',
        default: 50,
        description: 'Maximum number of events to return (default 50, max 200)',
      },
    }),
    name: 'list_project_activity',
  },
]
