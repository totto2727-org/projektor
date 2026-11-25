import { Schema } from 'effect'

import { structInOrder } from './ordered-schema.ts'

export const ApiUser = structInOrder([
  ['id', Schema.String],
  ['email', Schema.String],
  ['name', Schema.String],
])
export const ApiAuthInfo = structInOrder([
  ['kind', Schema.Literals(['human', 'agent'])],
  ['method', Schema.Literals(['oauth', 'pk', 'pat', 'access', 'dev', 'public'])],
  ['credentialId', Schema.optional(Schema.String)],
  ['clientId', Schema.optional(Schema.String)],
  ['scopes', Schema.optional(Schema.Array(Schema.String))],
  ['workspaceId', Schema.optional(Schema.NullOr(Schema.String))],
])
export const ApiPrincipal = structInOrder([
  ['user', ApiUser],
  ['auth', ApiAuthInfo],
  ['tokenWorkspaceId', Schema.optional(Schema.NullOr(Schema.String))],
  ['tokenScopes', Schema.optional(Schema.Array(Schema.String))],
])
export const ApiWorkspace = structInOrder([
  ['id', Schema.String],
  ['name', Schema.String],
  ['slug', Schema.String],
  ['role', Schema.String],
])
export const ApiWorkspaces = Schema.Array(ApiWorkspace)
export const ApiUserBootstrap = Schema.Struct({ user: ApiUser, workspaces: ApiWorkspaces })
export const ApiDevelopmentBootstrap = structInOrder([
  ['workspace', Schema.Struct({ id: Schema.String, name: Schema.String, slug: Schema.String })],
  ['user', ApiUser],
  ['token', Schema.String],
  ['mcpUrl', Schema.String],
  ['mcpAddCommand', Schema.String],
])

export const VerifiedApiOauthGrant = structInOrder([
  ['userId', Schema.String],
  ['email', Schema.String],
  ['name', Schema.String],
  ['workspaceId', Schema.String],
  ['scopes', Schema.Array(Schema.String)],
  ['clientId', Schema.optional(Schema.String)],
  ['credentialId', Schema.optional(Schema.String)],
])
