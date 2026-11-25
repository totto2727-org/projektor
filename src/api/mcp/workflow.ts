import { getWorkflow } from '#api/services/workflow.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { READ } from './annotations.ts'
import { objectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'

const WORKFLOW_VERSION_MAX_LENGTH = 64

export const workflowTools: MCPTool[] = [
  {
    annotations: READ,
    description:
      'Fetch the canonical agent workflow spec: definition of ready, state machine, human gates, ' +
      'completion report requirements, and WIP limits. Call this before claiming work. Returns a ' +
      'content `version` (a stable hash — unchanged unless the spec content changes). Pass a ' +
      'previously-returned version back as `ifVersion` to skip re-reading an unchanged spec: a ' +
      'match returns just `{ unchanged: true, version }` instead of the full content.',
    async handler(input, ctx) {
      return getWorkflow(ctx, input)
    },
    inputSchema: objectInputSchema({
      ifVersion: fieldsInOrder([
        ['type', 'string'],
        ['maxLength', WORKFLOW_VERSION_MAX_LENGTH],
        [
          'description',
          'A version previously returned by get_workflow. If it matches the current version, ' +
            'the response is `{ unchanged: true, version }` instead of the full spec.',
        ],
      ]),
    }),
    name: 'get_workflow',
  },
]
