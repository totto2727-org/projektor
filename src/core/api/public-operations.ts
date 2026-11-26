import { Effect } from 'effect'

import { visibleProjectIds } from '#commands/access.ts'
import { submitFeedback } from '#commands/feedback.ts'
import { lookupConsentWorkspace } from '#commands/oauth.ts'
import { getSharedIssue } from '#commands/share.ts'
import {
  ApiConsentWorkspace,
  ApiRealtimeSnapshot,
  ApiSharedIssue,
  ApiSubmittedFeedback,
} from '#contracts/api-public.ts'
import { HTTP_FORBIDDEN } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { requireCoreCapability, resolveCorePrincipal, resolveCoreServiceCtx } from '#core/authorization.ts'
import type { CoreActor } from '#core/authorization.ts'
import type { CoreReply } from '#core/contract.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'

interface ApiPublicHandlers<R> {
  apiConsentWorkspace: (actor: CoreActor, workspaceId: string) => CoreReply<R>
  apiSubmitFeedback: (token: string, body: unknown, origin: string | null) => CoreReply<R>
  apiGetSharedIssue: (token: string) => CoreReply<R>
  apiRealtimeSnapshot: (actor: CoreActor, workspaceId: string) => CoreReply<R>
}

/** Public credentials are resolved here, never treated as preauthenticated adapter IDs. */
export const makeApiPublicHandlers = function makeApiPublicHandlers<R>(
  envSource: Effect.Effect<CoreEnvironment, never, R>,
): ApiPublicHandlers<R> {
  const attempt = function attempt<A>(operation: (env: CoreEnvironment) => Promise<A>): Effect.Effect<A, unknown, R> {
    return Effect.flatMap(envSource, (env) =>
      Effect.tryPromise({ catch: publicDomainFailure, try: () => operation(env) }),
    )
  }
  return {
    apiConsentWorkspace: (actor: CoreActor, workspaceId: string): CoreReply<R> =>
      coreReply(
        'apiConsentWorkspace',
        ApiConsentWorkspace,
        attempt(async (env) => {
          const principal = await resolveCorePrincipal(actor, env)
          requireCoreCapability(principal, 'read')
          if (principal.auth.kind !== 'human' || !['access', 'dev'].includes(principal.auth.method)) {
            throw coreFailure(HTTP_FORBIDDEN, 'Connector authorization requires a signed-in browser session')
          }
          return lookupConsentWorkspace(env.DB, principal.user.id, workspaceId)
        }),
      ),
    apiSubmitFeedback: (token: string, body: unknown, origin: string | null): CoreReply<R> =>
      coreReply(
        'apiSubmitFeedback',
        ApiSubmittedFeedback,
        attempt((env) => submitFeedback(env.DB, token, body, origin)),
      ),
    apiGetSharedIssue: (token: string): CoreReply<R> =>
      coreReply(
        'apiGetSharedIssue',
        ApiSharedIssue,
        attempt((env) => getSharedIssue(env.DB, token)),
      ),
    apiRealtimeSnapshot: (actor: CoreActor, workspaceId: string): CoreReply<R> =>
      coreReply(
        'apiRealtimeSnapshot',
        ApiRealtimeSnapshot,
        attempt(async (env) => {
          const ctx = await resolveCoreServiceCtx(actor, workspaceId, 'read', env)
          return fieldsInOrder([
            ['userId', ctx.userId],
            ['workspaceId', ctx.workspaceId],
            ['role', ctx.role ?? 'viewer'],
            ['visibleProjectIds', await visibleProjectIds(ctx)],
          ])
        }),
      ),
  }
}
