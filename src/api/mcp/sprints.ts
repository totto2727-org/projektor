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
import { requiredObjectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const sprintsTools: MCPTool[] = [
  {
    annotations: READ,
    description: 'List sprints for a project, ordered by creation date',
    handler(input, ctx) {
      return listSprints(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId'], {
      projectId: { type: 'string', description: 'Project UUID' },
    }),
    name: 'list_sprints',
  },
  {
    annotations: READ,
    description: 'Get a sprint by ID',
    handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return getSprint(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string', description: 'Sprint UUID' },
    }),
    name: 'get_sprint',
  },
  {
    annotations: CREATE,
    description: 'Create a new sprint in a project',
    handler(input, ctx) {
      return createSprint(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId', 'name'], {
      projectId: { type: 'string' },
      name: { type: 'string' },
      goal: { type: 'string', description: 'Sprint goal description' },
      startDate: { type: 'number', description: 'Unix timestamp for sprint start' },
      endDate: { type: 'number', description: 'Unix timestamp for sprint end' },
    }),
    name: 'create_sprint',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Update sprint fields — name, goal, status, start/end dates',
    handler(input, ctx) {
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
    handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return completeSprint(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string', description: 'Sprint UUID' },
    }),
    name: 'complete_sprint',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete a sprint (issues in the sprint will have their sprint_id cleared)',
    handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteSprint(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string', description: 'Sprint UUID' },
    }),
    name: 'delete_sprint',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Bulk move issues into a sprint by setting their sprint_id',
    handler(input, ctx) {
      return moveIssuesToSprint(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['sprintId', 'issueIds'], {
      sprintId: { type: 'string', description: 'Target sprint UUID' },
      issueIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Issue UUIDs to move (max 500)',
      },
    }),
    name: 'move_issues_to_sprint',
  },
]
