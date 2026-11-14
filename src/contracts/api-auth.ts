import { Schema } from 'effect'

export const ApiUser = Schema.Struct({ id: Schema.String, email: Schema.String, name: Schema.String })
export const ApiAuthInfo = Schema.Struct({
  kind: Schema.Literals(['human', 'agent']),
  method: Schema.Literals(['oauth', 'pk', 'pat', 'access', 'dev', 'public']),
  credentialId: Schema.optional(Schema.String),
  clientId: Schema.optional(Schema.String),
  scopes: Schema.optional(Schema.Array(Schema.String)),
  workspaceId: Schema.optional(Schema.NullOr(Schema.String)),
})
export const ApiPrincipal = Schema.Struct({
  user: ApiUser,
  auth: ApiAuthInfo,
  tokenWorkspaceId: Schema.optional(Schema.NullOr(Schema.String)),
  tokenScopes: Schema.optional(Schema.Array(Schema.String)),
})
export const ApiWorkspace = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.String,
})
export const ApiWorkspaces = Schema.Array(ApiWorkspace)
export const ApiUserBootstrap = Schema.Struct({ user: ApiUser, workspaces: ApiWorkspaces })
export const ApiDevelopmentBootstrap = Schema.Struct({
  workspace: Schema.Struct({ id: Schema.String, name: Schema.String, slug: Schema.String }),
  user: ApiUser,
  token: Schema.String,
  mcpUrl: Schema.String,
  mcpAddCommand: Schema.String,
})

export const VerifiedApiOauthGrant = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  name: Schema.String,
  workspaceId: Schema.String,
  scopes: Schema.Array(Schema.String),
  clientId: Schema.optional(Schema.String),
  credentialId: Schema.optional(Schema.String),
})
