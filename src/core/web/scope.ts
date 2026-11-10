import { Schema } from 'effect'

import type { AuthInfo } from '#types'

import { ScopeError } from '../../web/server/errors'

export const WebRequestSchema = Schema.Struct({
  url: Schema.String,
  method: Schema.String,
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
})
export type WebRequest = typeof WebRequestSchema.Type

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

export const AuthUserSchema = Schema.Struct({
  id: NonEmptyString,
  email: NonEmptyString,
  name: Schema.String,
})
export type AuthUser = typeof AuthUserSchema.Type

export const WorkspaceMembershipSchema = Schema.Struct({
  id: NonEmptyString,
  name: Schema.String,
  slug: NonEmptyString,
  role: Schema.Literals(['owner', 'admin', 'member', 'viewer']),
})
export type WorkspaceMembership = typeof WorkspaceMembershipSchema.Type

export const AuthSessionSchema = Schema.Struct({
  user: AuthUserSchema,
  workspaces: Schema.Array(WorkspaceMembershipSchema),
})
export type AuthSession = typeof AuthSessionSchema.Type

/** The existing cross-workspace GET /api/projects response, not a new API DTO. */
export const ProjectSummarySchema = Schema.Struct({
  id: NonEmptyString,
  name: Schema.String,
  key: NonEmptyString,
  slug: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  workspace_id: NonEmptyString,
  workspace_name: Schema.String,
  workspace_slug: NonEmptyString,
  open_issue_count: Schema.Number,
  backlog_issue_count: Schema.Number,
  archived_at: Schema.NullOr(Schema.Number),
  created_at: Schema.Number,
  updated_at: Schema.Number,
})
export type ProjectSummary = typeof ProjectSummarySchema.Type
export const ProjectCatalogSchema = Schema.Array(ProjectSummarySchema)

export const decodeAuthSession = Schema.decodeUnknownSync(AuthSessionSchema)
export const decodeProjectCatalog = Schema.decodeUnknownSync(ProjectCatalogSchema)

export type ScopeSelection =
  | { readonly kind: 'global' }
  | { readonly kind: 'workspace'; readonly workspace: WorkspaceMembership }
  | {
      readonly kind: 'project'
      readonly workspace: WorkspaceMembership
      readonly project: ProjectSummary
    }
  | {
      readonly kind: 'selection-required'
      readonly target: 'workspace' | 'project'
      readonly reason: 'empty' | 'ambiguous'
    }

/** Serializable data only. The transport/Request/credentials never belong here. */
export interface RequestScope {
  readonly user: AuthUser
  readonly auth?: AuthInfo
  readonly workspaces: readonly WorkspaceMembership[]
  readonly projects: readonly ProjectSummary[]
  readonly selection: ScopeSelection
}

export interface ScopeOptions {
  readonly requireProject?: boolean
  readonly requireWorkspace?: boolean
  /** Route parameters may explicitly supply these, without client store fallback. */
  readonly projectHint?: string
  readonly workspaceHint?: string
}

export const ScopeOptionsSchema = Schema.Struct({
  requireProject: Schema.optional(Schema.Boolean),
  requireWorkspace: Schema.optional(Schema.Boolean),
  projectHint: Schema.optional(Schema.String),
  workspaceHint: Schema.optional(Schema.String),
})

export const RequestScopeSchema = Schema.Struct({
  user: AuthUserSchema,
  workspaces: Schema.Array(WorkspaceMembershipSchema),
  projects: ProjectCatalogSchema,
  auth: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(['human', 'agent']),
      method: Schema.Literals(['oauth', 'pk', 'pat', 'access', 'dev', 'public']),
      credentialId: Schema.optional(Schema.String),
      clientId: Schema.optional(Schema.String),
      scopes: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    }),
  ),
  selection: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('global') }),
    Schema.Struct({ kind: Schema.Literal('workspace'), workspace: WorkspaceMembershipSchema }),
    Schema.Struct({
      kind: Schema.Literal('project'),
      workspace: WorkspaceMembershipSchema,
      project: ProjectSummarySchema,
    }),
    Schema.Struct({
      kind: Schema.Literal('selection-required'),
      target: Schema.Literals(['workspace', 'project']),
      reason: Schema.Literals(['empty', 'ambiguous']),
    }),
  ]),
})

export function queryHint(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name).filter((value) => value !== '')
  if (new Set(values).size > 1) throw new ScopeError(400, `Ambiguous ${name} parameter.`)
  return values[0]
}

export function readProjectHint(url: URL): string | undefined {
  const query = queryHint(url, 'projectId') ?? queryHint(url, 'project')
  if (query) return query
  // Path parameters come from Effront's matched route through RequestServices.
  // Other ?id values identify issues, wiki pages or feedback, not projects.
  return url.pathname.replace(/\/$/, '') === '/projects/view' ? queryHint(url, 'id') : undefined
}

export function matchesProject(project: ProjectSummary, hint: string): boolean {
  return project.id === hint || project.key === hint || project.slug === hint
}

export function selectedWorkspace(
  workspaces: readonly WorkspaceMembership[],
  hint: string | undefined,
): WorkspaceMembership | undefined {
  if (!hint) return undefined
  const matches = workspaces.filter((workspace) => workspace.slug === hint)
  if (matches.length !== 1) throw new ScopeError(403, 'Selected workspace is not accessible.')
  return matches[0]
}

/** Pure selection policy, independent of browser state and framework lifecycle. */
export function resolveScope(
  session: AuthSession,
  projects: readonly ProjectSummary[],
  url: URL,
  options: ScopeOptions = {},
): RequestScope {
  const workspaceHint = options.workspaceHint ?? queryHint(url, 'workspace')
  const projectHint = options.projectHint ?? readProjectHint(url)
  const workspace = selectedWorkspace(session.workspaces, workspaceHint)
  const candidates = workspace ? projects.filter((project) => project.workspace_id === workspace.id) : projects
  let selection: ScopeSelection
  if (projectHint || options.requireProject) {
    const matches = projectHint ? candidates.filter((project) => matchesProject(project, projectHint)) : candidates
    if (projectHint && matches.length === 0) {
      throw new ScopeError(404, 'Selected project is not accessible.')
    }
    if (matches.length === 1) {
      const project = matches[0]
      const membership = session.workspaces.find(
        (item) => item.id === project.workspace_id && item.slug === project.workspace_slug,
      )
      if (!membership) throw new ScopeError(403, 'Selected project is not accessible.')
      selection = { kind: 'project', workspace: membership, project }
    } else {
      selection = {
        kind: 'selection-required',
        target: 'project',
        reason: matches.length === 0 ? 'empty' : 'ambiguous',
      }
    }
  } else if (workspace) {
    selection = { kind: 'workspace', workspace }
  } else if (options.requireWorkspace) {
    selection =
      session.workspaces.length === 1
        ? { kind: 'workspace', workspace: session.workspaces[0] }
        : {
            kind: 'selection-required',
            target: 'workspace',
            reason: session.workspaces.length === 0 ? 'empty' : 'ambiguous',
          }
  } else {
    selection = { kind: 'global' }
  }
  return { user: session.user, workspaces: session.workspaces, projects, selection }
}
