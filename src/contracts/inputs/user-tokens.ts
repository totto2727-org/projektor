import { z } from 'zod'

import { ScopeSchema } from '../auth-scopes.ts'

export const CreateUserTokenSchema = z.object({
  name: z.string().min(1).max(100),
  // Optional: omit for a user-scoped token (works across all the user's workspaces)
  workspaceId: z.uuid().optional(),
  scopes: z.array(ScopeSchema).min(1),
  expiresAt: z.number().int().positive().optional(),
})
