export { assertSameOriginMutation, checkSameOriginMutation } from './mutation'
export { ApiError, type ApiFailureKind, responseError, ScopeError } from './errors'
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
} from './request-context'
