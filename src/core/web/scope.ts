import { String, Predicate, Array, Result, Schema } from 'effect'
import type { SchemaAST } from 'effect'

import { ScopeError } from '#contracts/errors.ts'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import { hasSingleItem } from '#contracts/item-count.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { AuthInfo } from '#types'

const webRequestFields = fieldsInOrder([
  ['url', Schema.String],
  ['method', Schema.String],
  ['headers', Schema.Array(Schema.Tuple([Schema.String, Schema.String]))],
])

export const WebRequestSchema = Schema.Struct(webRequestFields)
export type WebRequest = typeof WebRequestSchema.Type

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

const authUserFields = fieldsInOrder([
  ['id', NonEmptyString],
  ['email', NonEmptyString],
  ['name', Schema.String],
])

export const AuthUserSchema = Schema.Struct(authUserFields)
export type AuthUser = typeof AuthUserSchema.Type

const workspaceMembershipFields = fieldsInOrder([
  ['id', NonEmptyString],
  ['name', Schema.String],
  ['slug', NonEmptyString],
  ['role', Schema.Literals(['owner', 'admin', 'member', 'viewer'])],
])

export const WorkspaceMembershipSchema = Schema.Struct(workspaceMembershipFields)
export type WorkspaceMembership = typeof WorkspaceMembershipSchema.Type

export const AuthSessionSchema = Schema.Struct({
  user: AuthUserSchema,
  workspaces: Schema.Array(WorkspaceMembershipSchema),
})
export type AuthSession = typeof AuthSessionSchema.Type

const projectSummaryFields = fieldsInOrder([
  ['id', NonEmptyString],
  ['name', Schema.String],
  ['key', NonEmptyString],
  ['slug', Schema.NullOr(Schema.String)],
  ['description', Schema.NullOr(Schema.String)],
  ['workspace_id', NonEmptyString],
  ['workspace_name', Schema.String],
  ['workspace_slug', NonEmptyString],
  ['open_issue_count', Schema.Number],
  ['backlog_issue_count', Schema.Number],
  ['archived_at', Schema.NullOr(Schema.Number)],
  ['created_at', Schema.Number],
  ['updated_at', Schema.Number],
])

/** The existing cross-workspace GET /api/projects response, not a new API DTO. */
export const ProjectSummarySchema = Schema.Struct(projectSummaryFields)
export type ProjectSummary = typeof ProjectSummarySchema.Type
export const ProjectCatalogSchema = Schema.Array(ProjectSummarySchema)

const decodeAuthSessionResult = Schema.decodeUnknownResult(AuthSessionSchema)
const decodeProjectCatalogResult = Schema.decodeUnknownResult(ProjectCatalogSchema)

export const decodeAuthSession = (input: unknown, options?: SchemaAST.ParseOptions): AuthSession =>
  Result.getOrThrow(decodeAuthSessionResult(input, options))

export const decodeProjectCatalog = (
  input: unknown,
  options?: SchemaAST.ParseOptions,
): typeof ProjectCatalogSchema.Type => Result.getOrThrow(decodeProjectCatalogResult(input, options))

export type ScopeSelection =
  | Readonly<{ kind: 'global' }>
  | Readonly<{ kind: 'workspace'; workspace: WorkspaceMembership }>
  | Readonly<{
      kind: 'project'
      workspace: WorkspaceMembership
      project: ProjectSummary
    }>
  | Readonly<{
      kind: 'selection-required'
      target: 'workspace' | 'project'
      reason: 'empty' | 'ambiguous'
    }>

/** Serializable data only. The transport/Request/credentials never belong here. */
export type RequestScope = Readonly<{
  user: AuthUser
  auth?: AuthInfo
  workspaces: Readonly<WorkspaceMembership[]>
  projects: Readonly<ProjectSummary[]>
  selection: ScopeSelection
}>

export type ScopeOptions = Readonly<{
  requireProject?: boolean
  requireWorkspace?: boolean
  /** Route parameters may explicitly supply these, without client store fallback. */
  projectHint?: string
  workspaceHint?: string
}>

const scopeOptionsFields = fieldsInOrder([
  ['requireProject', Schema.optional(Schema.Boolean)],
  ['requireWorkspace', Schema.optional(Schema.Boolean)],
  ['projectHint', Schema.optional(Schema.String)],
  ['workspaceHint', Schema.optional(Schema.String)],
])

export const ScopeOptionsSchema = Schema.Struct(scopeOptionsFields)

const requestScopeAuthFields = fieldsInOrder([
  ['kind', Schema.Literals(['human', 'agent'])],
  ['method', Schema.Literals(['oauth', 'pk', 'pat', 'access', 'dev', 'public'])],
  ['credentialId', Schema.optional(Schema.String)],
  ['clientId', Schema.optional(Schema.String)],
  ['scopes', Schema.optional(Schema.mutable(Schema.Array(Schema.String)))],
])

const projectScopeSelectionFields = fieldsInOrder([
  ['kind', Schema.Literal('project')],
  ['workspace', WorkspaceMembershipSchema],
  ['project', ProjectSummarySchema],
])

const requiredScopeSelectionFields = fieldsInOrder([
  ['kind', Schema.Literal('selection-required')],
  ['target', Schema.Literals(['workspace', 'project'])],
  ['reason', Schema.Literals(['empty', 'ambiguous'])],
])

const requestScopeFields = fieldsInOrder([
  ['user', AuthUserSchema],
  ['workspaces', Schema.Array(WorkspaceMembershipSchema)],
  ['projects', ProjectCatalogSchema],
  ['auth', Schema.optional(Schema.Struct(requestScopeAuthFields))],
  [
    'selection',
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal('global') }),
      Schema.Struct({ kind: Schema.Literal('workspace'), workspace: WorkspaceMembershipSchema }),
      Schema.Struct(projectScopeSelectionFields),
      Schema.Struct(requiredScopeSelectionFields),
    ]),
  ],
])

export const RequestScopeSchema = Schema.Struct(requestScopeFields)

export const queryHint = function queryHint(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name).filter((value) => String.isNonEmpty(value))
  if (new Set(values).size > 1) {
    throw new ScopeError(HTTP_BAD_REQUEST, `Ambiguous ${name} parameter.`)
  }
  return values[0]
}

export const readProjectHint = function readProjectHint(url: URL): string | undefined {
  const query = queryHint(url, 'projectId') ?? queryHint(url, 'project')
  if (Predicate.isNotNullish(query) && String.isNonEmpty(query)) {
    return query
  }
  // Path parameters come from Effront's matched route through RequestServices.
  // Other ?id values identify issues, wiki pages or feedback, not projects.
  return url.pathname.replace(/\/$/u, '') === '/projects/view' ? queryHint(url, 'id') : undefined
}

export const matchesProject = function matchesProject(project: ProjectSummary, hint: string): boolean {
  return project.id === hint || project.key === hint || project.slug === hint
}

export const selectedWorkspace = function selectedWorkspace(
  workspaces: Readonly<WorkspaceMembership[]>,
  hint: string | undefined,
): WorkspaceMembership | undefined {
  if (Predicate.isNullish(hint) || String.isEmpty(hint)) {
    return undefined
  }
  const matches = workspaces.filter((workspace) => workspace.slug === hint)
  if (!hasSingleItem(matches)) {
    throw new ScopeError(HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
  }
  return matches[0]
}

/** Pure selection policy, independent of browser state and framework lifecycle. */
export const resolveScope = function resolveScope(
  session: AuthSession,
  projects: Readonly<ProjectSummary[]>,
  url: URL,
  options: ScopeOptions = {},
): RequestScope {
  const workspaceHint = options.workspaceHint ?? queryHint(url, 'workspace')
  const projectHint = options.projectHint ?? readProjectHint(url)
  const workspace = selectedWorkspace(session.workspaces, workspaceHint)
  const candidates = workspace ? projects.filter((project) => project.workspace_id === workspace.id) : projects
  let selection: ScopeSelection
  if ((Predicate.isNotNullish(projectHint) && String.isNonEmpty(projectHint)) || options.requireProject === true) {
    const matches =
      Predicate.isNotNullish(projectHint) && String.isNonEmpty(projectHint)
        ? candidates.filter((project) => matchesProject(project, projectHint))
        : candidates
    if (Predicate.isNotNullish(projectHint) && String.isNonEmpty(projectHint) && Array.isReadonlyArrayEmpty(matches)) {
      throw new ScopeError(HTTP_NOT_FOUND, 'Selected project is not accessible.')
    }
    if (hasSingleItem(matches)) {
      const project = matches[0]
      const membership = session.workspaces.find(
        (item) => item.id === project.workspace_id && item.slug === project.workspace_slug,
      )
      if (!membership) {
        throw new ScopeError(HTTP_FORBIDDEN, 'Selected project is not accessible.')
      }
      selection = { kind: 'project', workspace: membership, project }
    } else {
      selection = {
        kind: 'selection-required',
        target: 'project',
        reason: Array.isReadonlyArrayEmpty(matches) ? 'empty' : 'ambiguous',
      }
    }
  } else if (workspace) {
    selection = { kind: 'workspace', workspace }
  } else if (options.requireWorkspace === true) {
    selection = hasSingleItem(session.workspaces)
      ? { kind: 'workspace', workspace: session.workspaces[0] }
      : {
          kind: 'selection-required',
          target: 'workspace',
          reason: Array.isReadonlyArrayEmpty(session.workspaces) ? 'empty' : 'ambiguous',
        }
  } else {
    selection = { kind: 'global' }
  }
  return { user: session.user, workspaces: session.workspaces, projects, selection }
}
