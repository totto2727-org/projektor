import { z } from 'zod'

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500

// PROJ-311: grant roles are the per-project subset of workspace roles (no owner).
export const GrantRoleEnum = z.enum(['viewer', 'member', 'admin'])

export const CreateGroupSchema = z.object({
  name: z.string().nonempty().max(MAX_NAME_LENGTH),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
})

export const UpdateGroupSchema = z.object({
  name: z.string().nonempty().max(MAX_NAME_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
})

export const AddGroupMemberSchema = z.object({
  userId: z.string().nonempty('userId is required'),
})

export const SetGroupGrantSchema = z.object({
  projectId: z.string().nonempty('projectId is required'),
  role: GrantRoleEnum,
})
