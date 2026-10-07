import { Effect, Schema } from 'effect'

import { RequestServices } from '../request'
import type { RequestApi } from './api-client'
import { type ApiError, ScopeError } from './errors'
import type { RequestScope } from './request-context'

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

/** Semantic selectors only. Each feature owns its individual Effront ServerFns. */
export const FunctionSelectorSchema = Schema.Struct({
  workspaceSlug: Schema.optional(NonEmptyString),
  projectId: Schema.optional(NonEmptyString),
})
export type FunctionSelector = typeof FunctionSelectorSchema.Type

export interface FunctionContext {
  readonly api: RequestApi
  readonly scope: RequestScope
  readonly workspaceSlug?: string
  readonly projectId?: string
}

export interface FunctionOptions {
  readonly requireWorkspace?: boolean
  readonly requireProject?: boolean
}

/** Resolve only authentication and selection, including independently callable queries. */
export function resolveFunctionContext(
  selector: FunctionSelector,
  options: FunctionOptions = {},
): Effect.Effect<FunctionContext, ApiError | ScopeError, RequestServices> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const input = yield* Schema.decodeUnknownEffect(FunctionSelectorSchema)(selector).pipe(
      Effect.mapError(() => new ScopeError(400, 'Invalid workspace or project selection.')),
    )
    const scope = yield* services.scope({
      // Empty hints explicitly suppress page-URL inference. /_effront/query
      // and a function invoked from an unrelated page resolve identically.
      workspaceHint: input.workspaceSlug ?? '',
      projectHint: input.projectId ?? '',
      requireWorkspace: options.requireWorkspace,
      requireProject: options.requireProject,
    })
    if (options.requireProject && !input.projectId) {
      return yield* new ScopeError(400, 'Select a project for this operation.')
    }
    if (options.requireWorkspace && !input.workspaceSlug && !input.projectId) {
      return yield* new ScopeError(400, 'Select a workspace for this operation.')
    }
    const selection = scope.selection
    if (selection.kind === 'selection-required') {
      return yield* new ScopeError(400, 'Select an accessible workspace or project.')
    }
    if (input.projectId && (selection.kind !== 'project' || selection.project.id !== input.projectId)) {
      return yield* new ScopeError(404, 'Selected project is not accessible.')
    }
    const workspace = selection.kind === 'project' || selection.kind === 'workspace' ? selection.workspace : undefined
    if (input.workspaceSlug && workspace?.slug !== input.workspaceSlug) {
      return yield* new ScopeError(403, 'Selected workspace is not accessible.')
    }
    if (workspace && !scope.workspaces.some((member) => member.id === workspace.id && member.slug === workspace.slug)) {
      return yield* new ScopeError(403, 'Selected workspace is not accessible.')
    }
    if (options.requireWorkspace && !workspace) {
      return yield* new ScopeError(403, 'Selected workspace is not accessible.')
    }
    if (options.requireProject && selection.kind !== 'project') {
      return yield* new ScopeError(404, 'Selected project is not accessible.')
    }
    return {
      api: services.api,
      scope,
      ...(workspace ? { workspaceSlug: workspace.slug } : {}),
      ...(selection.kind === 'project' ? { projectId: selection.project.id } : {}),
    }
  })
}
