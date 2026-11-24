import { Predicate } from 'effect'

import { composePlaybook } from '#api/services/playbook-compose.ts'
import { getPlaybook, listPlaybooks } from '#api/services/playbooks.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'

import { PLAIN_WRITE, READ } from './annotations.ts'
import { objectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const playbooksTools: MCPTool[] = [
  {
    name: 'list_playbooks',
    description:
      'List shipped agent playbooks — generic, reusable working patterns (e.g. epic-goal). ' +
      'Returns name/title/description/whenToUse for each; call get_playbook(name) for the full body.',
    inputSchema: objectInputSchema({}),
    annotations: READ,
    async handler(_input, ctx) {
      return listPlaybooks(ctx)
    },
  },
  {
    name: 'get_playbook',
    description: "Fetch a shipped playbook's full content by name.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Playbook name, e.g. "epic-goal"' },
      },
      required: ['name'],
    },
    annotations: READ,
    async handler(input, ctx) {
      const { name } = input as { name?: unknown }
      if (!name || !Predicate.isString(name)) {
        throw new ValidationError(validationIssues(['name is required'], {}))
      }
      return getPlaybook(ctx, name)
    },
  },
  {
    name: 'compose_playbook',
    description:
      'Fill a playbook template server-side using live project data (epic title, open child ' +
      'count, agent WIP limit). For "epic-goal": params.epicRef is required; ' +
      'params.variant (bounded|full, default bounded), params.reviewModel (default "opus"), ' +
      'params.cadence (default 2) are optional.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Playbook name, e.g. "epic-goal"' },
        params: {
          type: 'object',
          properties: {
            epicRef: { type: 'string', description: 'Epic ref, e.g. "PROJ-596"' },
            variant: { type: 'string', enum: ['bounded', 'full'] },
            reviewModel: { type: 'string' },
            cadence: { type: 'integer', minimum: 1 },
          },
          required: ['epicRef'],
        },
      },
      required: ['name', 'params'],
    },
    annotations: PLAIN_WRITE,
    async handler(input, ctx) {
      return await composePlaybook(ctx, input)
    },
  },
]
