import { z } from 'zod'

import { ScopeSchema } from '#contracts/auth-scopes.ts'

const MAX_TOKEN_NAME_LENGTH = 100

export const CreateUserTokenSchema = z.object({
  name: z.string().nonempty().max(MAX_TOKEN_NAME_LENGTH),
  // Optional: omit for a user-scoped token (works across all the user's workspaces)
  workspaceId: z.uuid().optional(),
  scopes: z.array(ScopeSchema).nonempty(),
  expiresAt: z.number().int().positive().optional(),
})
