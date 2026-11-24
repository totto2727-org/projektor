import { z } from 'zod'

import { ScopeSchema } from '#contracts/auth-scopes.ts'

export const CreateUserTokenSchema = z.object({
  name: z.string().nonempty().max(100),
  // Optional: omit for a user-scoped token (works across all the user's workspaces)
  workspaceId: z.uuid().optional(),
  scopes: z.array(ScopeSchema).nonempty(),
  expiresAt: z.number().int().positive().optional(),
})
