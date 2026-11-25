import { Effect, Schema } from 'effect'

import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_NOT_FOUND } from '#contracts/http-status.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { RequestServices } from '@/request.ts'

import { ScopeError } from './errors.ts'
import type { ApiError } from './errors.ts'
import type { RequestScope } from './request-context.ts'

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

/** Semantic selectors only. Each feature owns its individual Effront ServerFns. */
export const FunctionSelectorSchema = Schema.Struct({
  workspaceSlug: Schema.optional(NonEmptyString),
  projectId: Schema.optional(NonEmptyString),
})
export type FunctionSelector = typeof FunctionSelectorSchema.Type

export type FunctionContext = Readonly<{
  scope: RequestScope
  workspaceSlug?: string
  projectId?: string
}>

export type FunctionOptions = Readonly<{
  requireWorkspace?: boolean
  requireProject?: boolean
}>

/** Resolve only authentication and selection, including independently callable queries. */
export const resolveFunctionContext = function resolveFunctionContext(
  selector: FunctionSelector,
  options: FunctionOptions = {},
): Effect.Effect<FunctionContext, ApiError | ScopeError, RequestServices> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const input = yield* Schema.decodeUnknownEffect(FunctionSelectorSchema)(selector).pipe(
      Effect.mapError(() => new ScopeError(HTTP_BAD_REQUEST, 'Invalid workspace or project selection.')),
    )
    const scope = yield* services.scope({
      /*
       * Empty hints explicitly suppress page-URL inference. /_effront/query
       * and a function invoked from an unrelated page resolve identically.
       */
      workspaceHint: input.workspaceSlug ?? '',
      projectHint: input.projectId ?? '',
      requireWorkspace: options.requireWorkspace,
      requireProject: options.requireProject,
    })
    if (options.requireProject === true && !isNonEmptyText(input.projectId)) {
      return yield* new ScopeError(HTTP_BAD_REQUEST, 'Select a project for this operation.')
    }
    if (options.requireWorkspace === true && !isNonEmptyText(input.workspaceSlug) && !isNonEmptyText(input.projectId)) {
      return yield* new ScopeError(HTTP_BAD_REQUEST, 'Select a workspace for this operation.')
    }
    const { selection } = scope
    if (selection.kind === 'selection-required') {
      return yield* new ScopeError(HTTP_BAD_REQUEST, 'Select an accessible workspace or project.')
    }
    if (isNonEmptyText(input.projectId) && (selection.kind !== 'project' || selection.project.id !== input.projectId)) {
      return yield* new ScopeError(HTTP_NOT_FOUND, 'Selected project is not accessible.')
    }
    const workspace = selection.kind === 'project' || selection.kind === 'workspace' ? selection.workspace : undefined
    if (isNonEmptyText(input.workspaceSlug) && workspace?.slug !== input.workspaceSlug) {
      return yield* new ScopeError(HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
    }
    if (workspace && !scope.workspaces.some((member) => member.id === workspace.id && member.slug === workspace.slug)) {
      return yield* new ScopeError(HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
    }
    if (options.requireWorkspace === true && !workspace) {
      return yield* new ScopeError(HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
    }
    if (options.requireProject === true && selection.kind !== 'project') {
      return yield* new ScopeError(HTTP_NOT_FOUND, 'Selected project is not accessible.')
    }
    return {
      scope,
      ...(workspace ? { workspaceSlug: workspace.slug } : {}),
      ...(selection.kind === 'project' ? { projectId: selection.project.id } : {}),
    }
  })
}

const SelectedWorkspace = Schema.Struct({ workspaceSlug: NonEmptyString })
const hasWorkspaceSlug = Schema.is(SelectedWorkspace)
type WorkspaceFunctionContext = FunctionContext & typeof SelectedWorkspace.Type

export const resolveWorkspaceFunctionContext = function resolveWorkspaceFunctionContext(
  selector: FunctionSelector,
): Effect.Effect<WorkspaceFunctionContext, ApiError | ScopeError, RequestServices> {
  return Effect.gen(function* () {
    const context = yield* resolveFunctionContext(selector, { requireWorkspace: true })
    if (!hasWorkspaceSlug(context)) {
      return yield* new ScopeError(HTTP_FORBIDDEN, 'Select an accessible workspace.')
    }
    return context
  })
}
