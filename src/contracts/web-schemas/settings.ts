import { Schema } from 'effect'

import { structInOrder } from '#contracts/ordered-schema.ts'

const nullableText = Schema.NullOr(Schema.String)
const nullableNumber = Schema.NullOr(Schema.Finite)
const array = <S extends Schema.Constraint>(schema: S): Schema.mutable<Schema.$Array<S>> =>
  Schema.Array(schema).pipe(Schema.mutable)

export const GroupSchema = structInOrder([
  ['id', Schema.String],
  ['name', Schema.String],
  ['description', nullableText],
  ['memberCount', Schema.Finite],
  ['grantCount', Schema.Finite],
])
export const GroupsSchema = array(GroupSchema)
/** GET detail does not contain list aggregate columns. Derive counts after decoding. */
export const GroupDetailSchema = structInOrder([
  ['id', Schema.String],
  ['name', Schema.String],
  ['description', nullableText],
  [
    'members',
    array(
      structInOrder([
        ['userId', Schema.String],
        ['email', Schema.String],
        ['name', Schema.String],
      ]),
    ),
  ],
  [
    'grants',
    array(
      structInOrder([
        ['projectId', Schema.String],
        ['projectName', Schema.String],
        ['projectKey', Schema.String],
        ['role', Schema.Literals(['viewer', 'member', 'admin'])],
      ]),
    ),
  ],
])
export const WorkspaceSchema = Schema.Struct({
  currentUserRole: Schema.String,
  members: array(
    structInOrder([
      ['id', Schema.String],
      ['email', Schema.String],
      ['name', Schema.String],
      ['role', Schema.String],
    ]),
  ),
})
export const MemberGroupsSchema = array(
  structInOrder([
    ['userId', Schema.String],
    ['groups', array(Schema.Struct({ id: Schema.String, name: Schema.String }))],
  ]),
)
export const ProjectsSchema = array(
  structInOrder([
    ['id', Schema.String],
    ['name', Schema.String],
    ['key', Schema.String],
    ['workspace_slug', Schema.String],
  ]),
)
/** List scopes are JSON strings, unlike the token creation response's scope array. */
export const TokenSchema = structInOrder([
  ['id', Schema.String],
  ['name', Schema.String],
  ['scopes', Schema.String],
  ['lastUsedAt', nullableNumber],
  ['expiresAt', nullableNumber],
  ['createdAt', Schema.Finite],
])
export const TokensSchema = array(TokenSchema)
export const ConnectorSchema = structInOrder([
  ['id', Schema.String],
  ['client', Schema.String],
  ['clientId', Schema.String],
  ['scopes', array(Schema.String)],
  ['grantedAt', Schema.Finite],
  ['expiresAt', Schema.Finite],
])
export const ConnectorsSchema = array(ConnectorSchema)
export const McpInfoSchema = structInOrder([
  ['mcpUrl', Schema.String],
  ['mcpAddCommandTemplate', Schema.optionalKey(nullableText)],
])
export const SettingsGroupsSchema = structInOrder([
  ['groups', GroupsSchema],
  ['details', array(GroupDetailSchema)],
  ['members', WorkspaceSchema.fields.members],
  ['memberGroups', MemberGroupsSchema],
  ['projects', ProjectsSchema],
  ['role', Schema.String],
])
export const SettingsTokensSchema = structInOrder([
  ['tokens', TokensSchema],
  ['tokensDenied', Schema.Boolean],
  ['grants', ConnectorsSchema],
  ['connectorsDenied', Schema.Boolean],
  ['info', Schema.NullOr(McpInfoSchema)],
])
export const NewTokenSchema = structInOrder([
  ['id', Schema.String],
  ['token', Schema.String],
  ['name', Schema.String],
  ['scopes', array(Schema.String)],
  ['expiresAt', nullableNumber],
])
export const CreatedGroupSchema = structInOrder([
  ['id', Schema.String],
  ['name', Schema.String],
  ['description', nullableText],
])
export const SettingsOkSchema = Schema.Struct({ ok: Schema.Literal(true) })
