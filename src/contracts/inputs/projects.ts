import { z } from 'zod'

import { objectInOrder } from './common.ts'

const MAX_NAME_LENGTH = 100
const MAX_KEY_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 500
const MIN_AGENT_WIP_LIMIT = 1
const MAX_AGENT_WIP_LIMIT = 100

export const CreateProjectSchema = objectInOrder([
  ['name', z.string().nonempty().max(MAX_NAME_LENGTH)],
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
      .regex(/^[A-Z][A-Z0-9]*$/i)
      .transform((key) => key.toUpperCase()),
  ],
  ['description', z.string().max(MAX_DESCRIPTION_LENGTH).optional()],
  // PROJ-253: per-project agent WIP cap. null/omitted = workspace default.
  ['agentWipLimit', z.number().int().min(MIN_AGENT_WIP_LIMIT).max(MAX_AGENT_WIP_LIMIT).nullable().optional()],
])

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  archived: z.boolean().optional(),
})
