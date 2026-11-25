import { z } from 'zod'

import { ScopeSchema } from '#contracts/auth-scopes.ts'

import { objectInOrder, RoleEnum } from './common.ts'

const MAX_WORKSPACE_NAME_LENGTH = 100
const MIN_SLUG_LENGTH = 2
const MAX_SLUG_LENGTH = 50
const MAX_TOKEN_NAME_LENGTH = 100
const MIN_TOKEN_LIFETIME_DAYS = 1
const MAX_TOKEN_LIFETIME_DAYS = 365
const MAX_DISPLAY_NAME_LENGTH = 100
const MAX_FONT_FAMILY_LENGTH = 100

export const CreateWorkspaceSchema = z.object({
  name: z.string().nonempty().max(MAX_WORKSPACE_NAME_LENGTH),
  slug: z
    .string()
    .min(MIN_SLUG_LENGTH)
    .max(MAX_SLUG_LENGTH)
    .regex(/^[a-z0-9-]+$/),
})

export const UpdateWorkspaceSchema = z.object({
  name: z.string().nonempty().max(MAX_WORKSPACE_NAME_LENGTH),
})

export const InviteMemberSchema = z.object({
  email: z.email(),
  role: RoleEnum.default('member'),
})

export const UpdateRoleSchema = z.object({
  role: RoleEnum,
})

export const CreateTokenSchema = objectInOrder([
  ['name', z.string().nonempty().max(MAX_TOKEN_NAME_LENGTH)],
  ['scopes', z.array(ScopeSchema).nonempty().default(['read', 'write'])],
  ['expiresInDays', z.number().int().min(MIN_TOKEN_LIFETIME_DAYS).max(MAX_TOKEN_LIFETIME_DAYS).optional()],
])

export const DeleteWorkspaceInput = z.object({
  workspaceSlug: z.string(),
})

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const UpdateWorkspaceBrandSchema = objectInOrder([
  ['displayName', z.string().nonempty().max(MAX_DISPLAY_NAME_LENGTH).nullable().optional()],
  ['accent', HexColor.nullable().optional()],
  ['onAccent', HexColor.nullable().optional()],
  ['fontFamily', z.string().nonempty().max(MAX_FONT_FAMILY_LENGTH).nullable().optional()],
  [
    'fontUrl',
    z
      .string()
      .url()
      .refine((fontUrl) => fontUrl.startsWith('https://'), 'fontUrl must be an https:// URL')
      .nullable()
      .optional(),
  ],
]).strict()
