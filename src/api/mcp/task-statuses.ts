import { String, Predicate } from 'effect'

import { createTaskStatus, deleteTaskStatus, listTaskStatuses, updateTaskStatus } from '#api/services/task-statuses.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const taskStatusesTools: MCPTool[] = [
  {
    name: 'list_task_statuses',
    description: 'List all task statuses configured for the workspace',
    inputSchema: objectInputSchema({}),
    annotations: READ,
    handler(_input, ctx) {
      return listTaskStatuses(ctx)
    },
  },
  {
    name: 'create_task_status',
    description: 'Create a new task status for the workspace (owner/admin only)',
    inputSchema: requiredObjectInputSchema(['key', 'name', 'category'], {
      key: { type: 'string', description: 'Unique key (lowercase letters, digits, underscores)' },
      name: { type: 'string', description: 'Display name' },
      category: {
        type: 'string',
        enum: ['todo', 'in_progress', 'done', 'cancelled'],
        description: 'Workflow bucket',
      },
      color: { type: 'string', description: 'Optional color (hex or named)' },
      position: { type: 'number', description: 'Sort order position' },
      isDefault: { type: 'boolean', description: 'Set as the default status for new issues' },
      isReviewStep: {
        type: 'boolean',
        description:
          'Mark this status as a review step (completion-report gate, review flow metrics). Not inferred from the key.',
      },
    }),
    annotations: CREATE,
    handler(input, ctx) {
      return createTaskStatus(ctx, input)
    },
  },
  {
    name: 'update_task_status',
    description: 'Update a task status (owner/admin only)',
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
      name: { type: 'string' },
      category: { type: 'string', enum: ['todo', 'in_progress', 'done', 'cancelled'] },
      color: { type: 'string', nullable: true },
      position: { type: 'number' },
      isDefault: { type: 'boolean', description: 'Set as the default status for new issues' },
      isReviewStep: {
        type: 'boolean',
        description:
          'Mark this status as a review step (completion-report gate, review flow metrics). Not inferred from the key.',
      },
    }),
    annotations: IDEMPOTENT_WRITE,
    handler(input, ctx) {
      const { id, ...fields } = input as { id?: string; [k: string]: unknown }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return updateTaskStatus(ctx, id, fields)
    },
  },
  {
    name: 'delete_task_status',
    description: 'Delete a task status (owner/admin only). Fails if the status is in use or is the default.',
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
    }),
    annotations: DESTRUCTIVE,
    handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteTaskStatus(ctx, id)
    },
  },
]
