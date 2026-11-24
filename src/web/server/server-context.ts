export { assertSameOriginMutation, checkSameOriginMutation } from './mutation.ts'
export { ApiError, type ApiFailureKind, responseError, ScopeError } from './errors.ts'
export {
  type AuthSession,
  AuthSessionSchema,
  type AuthUser,
  AuthUserSchema,
  decodeAuthSession,
  decodeProjectCatalog,
  loadRequestScope,
  ProjectCatalogSchema,
  type ProjectSummary,
  ProjectSummarySchema,
  type RequestScope,
  readProjectHint,
  resolveScope,
  type ScopeOptions,
  type ScopeSelection,
  type WorkspaceMembership,
  WorkspaceMembershipSchema,
} from './request-context.ts'
