import { createProject, deleteProject, getProject, listProjects, updateProject } from '#api/services/projects.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const projectsTools: MCPTool[] = [
  {
    annotations: READ,
    description: 'List projects in the workspace. Archived projects are excluded by default.',
    async handler(input, ctx) {
      const { includeArchived } = (input ?? {}) as { includeArchived?: boolean }
      return listProjects(ctx, { includeArchived })
    },
    inputSchema: objectInputSchema({
      includeArchived: {
        type: 'boolean',
        description: 'Include archived projects in the results (default false)',
      },
    }),
    name: 'list_projects',
  },
  {
    annotations: CREATE,
    description: 'Create a new project in the workspace',
    async handler(input, ctx) {
      return await createProject(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['name', 'key'], {
      name: { type: 'string', description: 'Project name, max 100 characters' },
      key: {
        type: 'string',
        description: 'Short uppercase identifier, e.g. PROJ (max 10 chars, A-Z0-9)',
      },
      description: { type: 'string', description: 'Optional description, max 500 characters' },
    }),
    name: 'create_project',
  },
  {
    annotations: READ,
    description: 'Get a project by ID',
    async handler(input, ctx) {
      const { id } = input as { id: string }
      return getProject(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], { id: { type: 'string', description: 'Project ID' } }),
    name: 'get_project',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description:
      'Update a project name, description, or archived state (owner/admin only). Set archived: true to hide it from the default project list, false to restore it.',
    async handler(input, ctx) {
      const { id, ...fields } = input as { id: string; [k: string]: unknown }
      return updateProject(ctx, id, fields)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string', description: 'Project ID' },
      name: { type: 'string', description: 'New project name' },
      description: { type: 'string', description: 'New description' },
      archived: { type: 'boolean', description: 'Archive (true) or unarchive (false)' },
    }),
    name: 'update_project',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete a project and all its issues (owner only)',
    async handler(input, ctx) {
      const { id } = input as { id: string }
      return deleteProject(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], { id: { type: 'string', description: 'Project ID' } }),
    name: 'delete_project',
  },
]
