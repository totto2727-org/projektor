import { z } from 'zod'

import { objectInOrder } from './common.ts'

export const ComposePlaybookSchema = z.object({
  name: z.string(),
  params: objectInOrder([
    ['epicRef', z.string()],
    ['variant', z.enum(['bounded', 'full']).optional()],
    ['reviewModel', z.string().optional()],
    ['cadence', z.number().int().positive().optional()],
    ['checkpointInterval', z.number().int().positive().optional()],
  ]),
})
