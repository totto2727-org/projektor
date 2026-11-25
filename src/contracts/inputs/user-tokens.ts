import { z } from 'zod'

import { ScopeSchema } from '#contracts/auth-scopes.ts'

import { objectInOrder } from './common.ts'

const MAX_TOKEN_NAME_LENGTH = 100

export const CreateUserTokenSchema = objectInOrder([
  ['name', z.string().nonempty().max(MAX_TOKEN_NAME_LENGTH)],
  // Optional: omit for a user-scoped token (works across all the user's workspaces)
  ['workspaceId', z.uuid().optional()],
  ['scopes', z.array(ScopeSchema).nonempty()],
  ['expiresAt', z.number().int().positive().optional()],
])
