import { String, Predicate } from 'effect'

import { createTaskStatus, deleteTaskStatus, listTaskStatuses, updateTaskStatus } from '#api/services/task-statuses.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const taskStatusesTools: MCPTool[] = [
  {
    annotations: READ,
    description: 'List all task statuses configured for the workspace',
    async handler(_input, ctx) {
      return listTaskStatuses(ctx)
    },
    inputSchema: objectInputSchema({}),
    name: 'list_task_statuses',
  },
  {
    annotations: CREATE,
    description: 'Create a new task status for the workspace (owner/admin only)',
    async handler(input, ctx) {
      return createTaskStatus(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(
      ['key', 'name', 'category'],
      fieldsInOrder([
        ['key', describedInputProperty('string', 'Unique key (lowercase letters, digits, underscores)')],
        ['name', describedInputProperty('string', 'Display name')],
        [
          'category',
          fieldsInOrder([
            ['type', 'string'],
            ['enum', ['todo', 'in_progress', 'done', 'cancelled']],
            ['description', 'Workflow bucket'],
          ]),
        ],
        ['color', describedInputProperty('string', 'Optional color (hex or named)')],
        ['position', describedInputProperty('number', 'Sort order position')],
        ['isDefault', describedInputProperty('boolean', 'Set as the default status for new issues')],
        [
          'isReviewStep',
          describedInputProperty(
            'boolean',
            'Mark this status as a review step (completion-report gate, review flow metrics). Not inferred from the key.',
          ),
        ],
      ]),
    ),
    name: 'create_task_status',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Update a task status (owner/admin only)',
    async handler(input, ctx) {
      const { id, ...fields } = input as { id?: string; [k: string]: unknown }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return updateTaskStatus(ctx, id, fields)
    },
    inputSchema: requiredObjectInputSchema(
      ['id'],
      fieldsInOrder([
        ['id', { type: 'string' }],
        ['name', { type: 'string' }],
        [
          'category',
          fieldsInOrder([
            ['type', 'string'],
            ['enum', ['todo', 'in_progress', 'done', 'cancelled']],
          ]),
        ],
        [
          'color',
          fieldsInOrder([
            ['type', 'string'],
            ['nullable', true],
          ]),
        ],
        ['position', { type: 'number' }],
        ['isDefault', describedInputProperty('boolean', 'Set as the default status for new issues')],
        [
          'isReviewStep',
          describedInputProperty(
            'boolean',
            'Mark this status as a review step (completion-report gate, review flow metrics). Not inferred from the key.',
          ),
        ],
      ]),
    ),
    name: 'update_task_status',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete a task status (owner/admin only). Fails if the status is in use or is the default.',
    async handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteTaskStatus(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
    }),
    name: 'delete_task_status',
  },
]
