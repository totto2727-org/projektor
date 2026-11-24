import { z } from 'zod'

// PROJ-311: grant roles are the per-project subset of workspace roles (no owner).
export const GrantRoleEnum = z.enum(['viewer', 'member', 'admin'])

export const CreateGroupSchema = z.object({
  name: z.string().nonempty().max(100),
  description: z.string().max(500).nullable().optional(),
})

export const UpdateGroupSchema = z.object({
  name: z.string().nonempty().max(100).optional(),
  description: z.string().max(500).nullable().optional(),
})

export const AddGroupMemberSchema = z.object({
  userId: z.string().nonempty('userId is required'),
})

export const SetGroupGrantSchema = z.object({
  projectId: z.string().nonempty('projectId is required'),
  role: GrantRoleEnum,
})
