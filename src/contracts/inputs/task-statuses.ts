import { Array } from 'effect'
import { z } from 'zod'

import { objectInOrder } from './common.ts'

const MAX_KEY_LENGTH = 50
const MAX_NAME_LENGTH = 100
const MAX_COLOR_LENGTH = 50

const CategoryEnum = z.enum(['todo', 'in_progress', 'done', 'cancelled'])

export const CreateTaskStatusSchema = objectInOrder([
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
  ['name', z.string().nonempty().max(MAX_NAME_LENGTH)],
  ['category', CategoryEnum],
  ['color', z.string().max(MAX_COLOR_LENGTH).optional()],
  ['position', z.number().int().nonnegative().optional()],
  ['isDefault', z.boolean().optional()],
  /*
   * PROJ-749: explicit review step (the review gate + review flow metrics). Not inferred
   * from the key.
   */
  ['isReviewStep', z.boolean().optional()],
])

export const UpdateTaskStatusSchema = objectInOrder([
  ['name', z.string().nonempty().max(MAX_NAME_LENGTH).optional()],
  ['category', CategoryEnum.optional()],
  ['color', z.string().max(MAX_COLOR_LENGTH).nullable().optional()],
  ['position', z.number().int().nonnegative().optional()],
  ['isDefault', z.boolean().optional()],
  ['isReviewStep', z.boolean().optional()],
]).refine((obj) => Array.isArrayNonEmpty(Object.keys(obj)), { message: 'Nothing to update' })
