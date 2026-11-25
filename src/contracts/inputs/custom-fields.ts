import { Array } from 'effect'
import { z } from 'zod'

import { objectInOrder } from './common.ts'

const MAX_KEY_LENGTH = 50
const MAX_LABEL_LENGTH = 100
const MAX_OPTION_LENGTH = 100
const MAX_OPTION_COUNT = 100

const CustomFieldTypeEnum = z.enum(['text', 'number', 'select', 'date', 'user'])

export const CreateCustomFieldDefSchema = objectInOrder([
  [
    'key',
    z
      .string()
      .nonempty()
      .max(MAX_KEY_LENGTH)
      .regex(
        /^[a-z][a-z0-9_]*$/u,
        'Key must start with a letter and contain only lowercase letters, digits, or underscores',
      ),
  ],
  ['label', z.string().nonempty().max(MAX_LABEL_LENGTH)],
  ['type', CustomFieldTypeEnum],
  ['options', z.array(z.string().nonempty().max(MAX_OPTION_LENGTH)).max(MAX_OPTION_COUNT).optional()],
  ['projectId', z.uuid().nullable().optional()],
])

export const UpdateCustomFieldDefSchema = z
  .object({
    label: z.string().nonempty().max(MAX_LABEL_LENGTH).optional(),
    options: z.array(z.string().nonempty().max(MAX_OPTION_LENGTH)).max(MAX_OPTION_COUNT).nullable().optional(),
  })
  .refine((obj) => Array.isArrayNonEmpty(Object.keys(obj)), { message: 'Nothing to update' })

export const CustomFieldFilterSchema = z.object({
  cfKey: z.string().optional(),
  cfOp: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']).optional(),
  cfValue: z.string().optional(),
})
