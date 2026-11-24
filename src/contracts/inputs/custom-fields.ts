import { Array } from 'effect'
import { z } from 'zod'

const CustomFieldTypeEnum = z.enum(['text', 'number', 'select', 'date', 'user'])

export const CreateCustomFieldDefSchema = z.object({
  key: z
    .string()
    .nonempty()
    .max(50)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Key must start with a letter and contain only lowercase letters, digits, or underscores',
    ),
  label: z.string().nonempty().max(100),
  type: CustomFieldTypeEnum,
  options: z.array(z.string().nonempty().max(100)).max(100).optional(),
  projectId: z.uuid().nullable().optional(),
})

export const UpdateCustomFieldDefSchema = z
  .object({
    label: z.string().nonempty().max(100).optional(),
    options: z.array(z.string().nonempty().max(100)).max(100).nullable().optional(),
  })
  .refine((obj) => Array.isArrayNonEmpty(Object.keys(obj)), { message: 'Nothing to update' })

export const CustomFieldFilterSchema = z.object({
  cfKey: z.string().optional(),
  cfOp: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']).optional(),
  cfValue: z.string().optional(),
})
