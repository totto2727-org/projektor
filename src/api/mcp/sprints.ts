import { String, Predicate } from 'effect'

import {
  completeSprint,
  createSprint,
  deleteSprint,
  getSprint,
  listSprints,
  moveIssuesToSprint,
  updateSprint,
} from '#api/services/sprints.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, PLAIN_WRITE, READ } from './annotations.ts'
import { requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const sprintsTools: MCPTool[] = [
  {
    annotations: READ,
    description: 'List sprints for a project, ordered by creation date',
    async handler(input, ctx) {
      return listSprints(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId'], {
      projectId: describedInputProperty('string', 'Project UUID'),
    }),
    name: 'list_sprints',
  },
  {
    annotations: READ,
    description: 'Get a sprint by ID',
    async handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return getSprint(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: describedInputProperty('string', 'Sprint UUID'),
    }),
    name: 'get_sprint',
  },
  {
    annotations: CREATE,
    description: 'Create a new sprint in a project',
    async handler(input, ctx) {
      return createSprint(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId', 'name'], {
      projectId: { type: 'string' },
      name: { type: 'string' },
      goal: describedInputProperty('string', 'Sprint goal description'),
      startDate: describedInputProperty('number', 'Unix timestamp for sprint start'),
      endDate: describedInputProperty('number', 'Unix timestamp for sprint end'),
    }),
    name: 'create_sprint',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Update sprint fields — name, goal, status, start/end dates',
    async handler(input, ctx) {
      const { id, ...fields } = input as { id?: string; [k: string]: unknown }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return updateSprint(ctx, id, fields)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
      name: { type: 'string' },
      goal: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['planned', 'active', 'completed'] },
      startDate: { type: 'number', nullable: true },
      endDate: { type: 'number', nullable: true },
    }),
    name: 'update_sprint',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Mark an active sprint as completed',
    async handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return completeSprint(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: describedInputProperty('string', 'Sprint UUID'),
    }),
    name: 'complete_sprint',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete a sprint (issues in the sprint will have their sprint_id cleared)',
    async handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteSprint(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: describedInputProperty('string', 'Sprint UUID'),
    }),
    name: 'delete_sprint',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Bulk move issues into a sprint by setting their sprint_id',
    async handler(input, ctx) {
      return moveIssuesToSprint(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['sprintId', 'issueIds'], {
      sprintId: describedInputProperty('string', 'Target sprint UUID'),
      issueIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Issue UUIDs to move (max 500)',
      },
    }),
    name: 'move_issues_to_sprint',
  },
]
