import { Array } from 'effect'
import { z } from 'zod'

import { objectInOrder } from './common.ts'

const MAX_NAME_LENGTH = 255
const MAX_GOAL_LENGTH = 2000
const MAX_MOVE_ISSUES = 500

const SprintStatusEnum = z.enum(['planned', 'active', 'completed'])

export const ListSprintsSchema = z.object({
  projectId: z.uuid(),
})

export const CreateSprintSchema = objectInOrder([
  ['projectId', z.uuid()],
  ['name', z.string().nonempty().max(MAX_NAME_LENGTH)],
  ['goal', z.string().max(MAX_GOAL_LENGTH).optional()],
  ['startDate', z.number().int().optional()],
  ['endDate', z.number().int().optional()],
])

export const UpdateSprintSchema = objectInOrder([
  ['name', z.string().nonempty().max(MAX_NAME_LENGTH).optional()],
  ['goal', z.string().max(MAX_GOAL_LENGTH).nullable().optional()],
  ['status', SprintStatusEnum.optional()],
  ['startDate', z.number().int().nullable().optional()],
  ['endDate', z.number().int().nullable().optional()],
]).refine((obj) => Array.isArrayNonEmpty(Object.keys(obj)), { message: 'Nothing to update' })

export const MoveIssuesToSprintSchema = z.object({
  issueIds: z.array(z.uuid()).nonempty().max(MAX_MOVE_ISSUES),
  sprintId: z.uuid(),
})
