import { z } from 'zod'

import { MAX_PROJECT_DESCRIPTION_LENGTH, MAX_PROJECT_NAME_LENGTH } from '#contracts/project-limits.ts'

import { objectInOrder } from './common.ts'

const MAX_KEY_LENGTH = 10
const MIN_AGENT_WIP_LIMIT = 1
const MAX_AGENT_WIP_LIMIT = 100

export const CreateProjectSchema = objectInOrder([
  ['name', z.string().nonempty().max(MAX_PROJECT_NAME_LENGTH)],
  [
    'key',
    z
      .string()
      .nonempty()
      .max(MAX_KEY_LENGTH)
      /*
       * PROJ-440: no leading digit, so KEY-NUMBER issue refs (ISSUE_REF_PATTERN in
       * services/issues.ts) stay unambiguous.
       */
      // oxlint-disable-next-line eslint/require-unicode-regexp -- Keep ASCII-only key folding and Zod's public regex error metadata.
      .regex(/^[A-Z][A-Z0-9]*$/i)
      .transform((key) => key.toUpperCase()),
  ],
  ['description', z.string().max(MAX_PROJECT_DESCRIPTION_LENGTH).optional()],
  // PROJ-253: per-project agent WIP cap. null/omitted = workspace default.
  ['agentWipLimit', z.number().int().min(MIN_AGENT_WIP_LIMIT).max(MAX_AGENT_WIP_LIMIT).nullable().optional()],
])

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  archived: z.boolean().optional(),
})
