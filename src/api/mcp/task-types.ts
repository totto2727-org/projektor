import { String, Predicate } from 'effect'

import { createTaskType, deleteTaskType, listTaskTypes, updateTaskType } from '#api/services/task-types.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const taskTypesTools: MCPTool[] = [
  {
    annotations: READ,
    description: 'List all task types configured for the workspace',
    handler(_input, ctx) {
      return listTaskTypes(ctx)
    },
    inputSchema: objectInputSchema({}),
    name: 'list_task_types',
  },
  {
    annotations: CREATE,
    description: 'Create a new task type for the workspace (owner/admin only)',
    handler(input, ctx) {
      return createTaskType(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['key', 'name'], {
      key: describedInputProperty('string', 'Unique key (lowercase letters, digits, underscores)'),
      name: describedInputProperty('string', 'Display name'),
      color: describedInputProperty('string', 'Optional color (hex or named)'),
      icon: describedInputProperty('string', 'Optional icon identifier'),
      position: describedInputProperty('number', 'Sort order position'),
      isDefault: describedInputProperty('boolean', 'Set as the default type for new issues'),
    }),
    name: 'create_task_type',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Update a task type (owner/admin only)',
    handler(input, ctx) {
      const { id, ...fields } = input as { id?: string; [k: string]: unknown }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return updateTaskType(ctx, id, fields)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
      name: { type: 'string' },
      color: { type: 'string', nullable: true },
      icon: { type: 'string', nullable: true },
      position: { type: 'number' },
      isDefault: describedInputProperty('boolean', 'Set as the default type for new issues'),
    }),
    name: 'update_task_type',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete a task type (owner/admin only). Fails if the type is in use by any issues.',
    handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteTaskType(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
    }),
    name: 'delete_task_type',
  },
]
