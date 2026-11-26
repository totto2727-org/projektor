import { Array } from 'effect'
import { z } from 'zod'

import { objectInOrder } from './common.ts'

const MAX_KEY_LENGTH = 50
const MAX_NAME_LENGTH = 100
const MAX_COLOR_LENGTH = 50
const MAX_ICON_LENGTH = 50

export const CreateTaskTypeSchema = objectInOrder([
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
  ['color', z.string().max(MAX_COLOR_LENGTH).optional()],
  ['icon', z.string().max(MAX_ICON_LENGTH).optional()],
  ['position', z.number().int().nonnegative().optional()],
  ['isDefault', z.boolean().optional()],
])

export const UpdateTaskTypeSchema = objectInOrder([
  ['name', z.string().nonempty().max(MAX_NAME_LENGTH).optional()],
  ['color', z.string().max(MAX_COLOR_LENGTH).nullable().optional()],
  ['icon', z.string().max(MAX_ICON_LENGTH).nullable().optional()],
  ['position', z.number().int().nonnegative().optional()],
  ['isDefault', z.boolean().optional()],
]).refine((obj) => Array.isArrayNonEmpty(Object.keys(obj)), { message: 'Nothing to update' })
