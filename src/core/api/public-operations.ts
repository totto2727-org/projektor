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
} from '../../contracts/api-public.ts'
import { requireCoreCapability, resolveCorePrincipal, resolveCoreServiceCtx } from '../authorization.ts'
import type { CoreActor } from '../authorization.ts'
import { coreFailure, coreReply } from '../contract.ts'
import { publicDomainFailure } from '../domain-errors.ts'
import type { CoreEnvironment } from '../environment.ts'

/** Public credentials are resolved here, never treated as preauthenticated adapter IDs. */
export function makeApiPublicHandlers<R>(envSource: Effect.Effect<CoreEnvironment, never, R>) {
  const attempt = function attempt<A>(operation: (env: CoreEnvironment) => Promise<A>) {
    return Effect.flatMap(envSource, (env) =>
      Effect.tryPromise({ try: () => operation(env), catch: publicDomainFailure }),
    )
  }
  return {
    apiConsentWorkspace: (actor: CoreActor, workspaceId: string) =>
      coreReply(
        'apiConsentWorkspace',
        ApiConsentWorkspace,
        attempt(async (env) => {
          const principal = await resolveCorePrincipal(actor, env)
          requireCoreCapability(principal, 'read')
          if (principal.auth.kind !== 'human' || !['access', 'dev'].includes(principal.auth.method)) {
            throw coreFailure(403, 'Connector authorization requires a signed-in browser session')
          }
          return lookupConsentWorkspace(env.DB, principal.user.id, workspaceId)
        }),
      ),
    apiSubmitFeedback: (token: string, body: unknown, origin: string | null) =>
      coreReply(
        'apiSubmitFeedback',
        ApiSubmittedFeedback,
        attempt((env) => submitFeedback(env.DB, token, body, origin)),
      ),
    apiGetSharedIssue: (token: string) =>
      coreReply(
        'apiGetSharedIssue',
        ApiSharedIssue,
        attempt((env) => getSharedIssue(env.DB, token)),
      ),
    apiRealtimeSnapshot: (actor: CoreActor, workspaceId: string) =>
      coreReply(
        'apiRealtimeSnapshot',
        ApiRealtimeSnapshot,
        attempt(async (env) => {
          const ctx = await resolveCoreServiceCtx(actor, workspaceId, 'read', env)
          return {
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
            role: ctx.role ?? 'viewer',
            visibleProjectIds: await visibleProjectIds(ctx),
          }
        }),
      ),
  }
}
