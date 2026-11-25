import { String, Predicate } from 'effect'

import {
  createCustomFieldDef,
  deleteCustomFieldDef,
  listCustomFieldDefs,
  updateCustomFieldDef,
} from '#api/services/custom-fields.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const customFieldsTools: MCPTool[] = [
  {
    annotations: READ,
    description: 'List all custom field definitions for the workspace',
    async handler(input, ctx) {
      const { projectId } = (input as { projectId?: string }) ?? {}
      return listCustomFieldDefs(ctx, projectId)
    },
    inputSchema: objectInputSchema({
      projectId: describedInputProperty(
        'string',
        'Optional project ID to include project-scoped fields alongside workspace-wide fields',
      ),
    }),
    name: 'list_custom_field_defs',
  },
  {
    annotations: CREATE,
    description: 'Create a new custom field definition (owner/admin only)',
    async handler(input, ctx) {
      return createCustomFieldDef(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['key', 'label', 'type'], {
      key: describedInputProperty('string', 'Unique key (lowercase letters, digits, underscores)'),
      label: describedInputProperty('string', 'Human-readable label'),
      type: {
        type: 'string',
        enum: ['text', 'number', 'select', 'date', 'user'],
        description: 'Field type',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Allowed options (required for select type)',
      },
      projectId: {
        type: 'string',
        nullable: true,
        description: 'Scope to a specific project (null = workspace-wide)',
      },
    }),
    name: 'create_custom_field_def',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Update a custom field definition label or options (owner/admin only)',
    async handler(input, ctx) {
      const { id, ...fields } = input as { id?: string; [k: string]: unknown }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return updateCustomFieldDef(ctx, id, fields)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
      label: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, nullable: true },
    }),
    name: 'update_custom_field_def',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete a custom field definition (owner/admin only). Fails if any issues have values for this field.',
    async handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteCustomFieldDef(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string' },
    }),
    name: 'delete_custom_field_def',
  },
]
