import { Array } from 'effect'
import { z } from 'zod'

const CategoryEnum = z.enum(['todo', 'in_progress', 'done', 'cancelled'])

export const CreateTaskStatusSchema = z.object({
  key: z
    .string()
    .nonempty()
    .max(50)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Key must start with a letter and contain only lowercase letters, digits, or underscores',
    ),
  name: z.string().nonempty().max(100),
  category: CategoryEnum,
  color: z.string().max(50).optional(),
  position: z.number().int().nonnegative().optional(),
  isDefault: z.boolean().optional(),
  /*
   * PROJ-749: explicit review step (the review gate + review flow metrics). Not inferred
   * from the key.
   */
  isReviewStep: z.boolean().optional(),
})

export const UpdateTaskStatusSchema = z
  .object({
    name: z.string().nonempty().max(100).optional(),
    category: CategoryEnum.optional(),
    color: z.string().max(50).nullable().optional(),
    position: z.number().int().nonnegative().optional(),
    isDefault: z.boolean().optional(),
    isReviewStep: z.boolean().optional(),
  })
  .refine((obj) => Array.isArrayNonEmpty(Object.keys(obj)), { message: 'Nothing to update' })
