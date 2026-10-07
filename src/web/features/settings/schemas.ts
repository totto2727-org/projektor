import { Schema } from 'effect'

const nullableText = Schema.NullOr(Schema.String)
const nullableNumber = Schema.NullOr(Schema.Finite)
const array = <S extends Schema.Constraint>(schema: S) => Schema.Array(schema).pipe(Schema.mutable)

export const GroupSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: nullableText,
  memberCount: Schema.Finite,
  grantCount: Schema.Finite,
})
export const GroupsSchema = array(GroupSchema)
/** GET detail does not contain list aggregate columns. Derive counts after decoding. */
export const GroupDetailSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: nullableText,
  members: array(Schema.Struct({ userId: Schema.String, email: Schema.String, name: Schema.String })),
  grants: array(
    Schema.Struct({
      projectId: Schema.String,
      projectName: Schema.String,
      projectKey: Schema.String,
      role: Schema.Literals(['viewer', 'member', 'admin']),
    }),
  ),
})
export const WorkspaceSchema = Schema.Struct({
  currentUserRole: Schema.String,
  members: array(
    Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      name: Schema.String,
      role: Schema.String,
    }),
  ),
})
export const MemberGroupsSchema = array(
  Schema.Struct({
    userId: Schema.String,
    groups: array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  }),
)
export const ProjectsSchema = array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    key: Schema.String,
    workspace_slug: Schema.String,
  }),
)
/** List scopes are JSON strings, unlike the token creation response's scope array. */
export const TokenSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  scopes: Schema.String,
  lastUsedAt: nullableNumber,
  expiresAt: nullableNumber,
  createdAt: Schema.Finite,
})
export const TokensSchema = array(TokenSchema)
export const ConnectorSchema = Schema.Struct({
  id: Schema.String,
  client: Schema.String,
  clientId: Schema.String,
  scopes: array(Schema.String),
  grantedAt: Schema.Finite,
  expiresAt: Schema.Finite,
})
export const ConnectorsSchema = array(ConnectorSchema)
export const McpInfoSchema = Schema.Struct({
  mcpUrl: Schema.String,
  mcpAddCommandTemplate: Schema.optionalKey(nullableText),
})
