import { Effect, Schema } from 'effect'

import type { ServiceCtx } from '#commands/types.ts'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_TOO_MANY_REQUESTS } from '#contracts/http-status.ts'
import { assertSameOriginMutation } from '#contracts/mutation.ts'
import { requireDataWorkspace } from '#contracts/web-data.ts'
import { coreFailure } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { checkRateLimit } from '#services/request-rate-limit.ts'

import { loadBrowserScope, nativeRequest, publicWebFailure } from './authentication.ts'
import { BrowserCommandSchema } from './command-contract.ts'
import type { BrowserCommand } from './command-contract.ts'

/** Proof and selectors cross the binding. Storage capabilities are constructed only in Core. */
export const browserCommand = function browserCommand<A>(
  env: CoreEnvironment,
  input: BrowserCommand,
  operation: (ctx: ServiceCtx) => Promise<A>,
): Effect.Effect<A, unknown> {
  return Effect.gen(function* () {
    const proof = yield* Schema.decodeUnknownEffect(BrowserCommandSchema)(input).pipe(
      Effect.mapError(() => coreFailure(HTTP_BAD_REQUEST, 'Invalid browser command.')),
    )
    const request = nativeRequest(proof.request)
    yield* Effect.try({
      catch: publicWebFailure,
      try: () => {
        assertSameOriginMutation(request)
      },
    })
    const scope = yield* loadBrowserScope(env, proof.request, {
      workspaceHint: proof.workspaceSlug,
      projectHint: proof.projectId ?? '',
      requireWorkspace: true,
    })
    const workspace = yield* Effect.try({ catch: publicWebFailure, try: () => requireDataWorkspace(scope) })
    if (workspace.slug !== proof.workspaceSlug) {
      return yield* coreFailure(HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
    }
    const auth = scope.auth
    if (!auth || auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
      return yield* coreFailure(HTTP_FORBIDDEN, 'An interactive browser session is required.')
    }
    const limited = yield* Effect.tryPromise({ catch: publicDomainFailure, try: () => checkRateLimit(request, env) })
    if (limited) {
      return yield* coreFailure(HTTP_TOO_MANY_REQUESTS, 'Too many requests', { retryAfter: limited.retryAfter })
    }
    const ctx: ServiceCtx = {
      db: env.DB,
      kv: env.KV,
      r2: env.R2,
      workspaceId: workspace.id,
      userId: scope.user.id,
      role: workspace.role,
      authKind: 'human',
      auth,
      workspaceHub: env.WORKSPACE_HUB,
    }
    return yield* Effect.tryPromise({ catch: publicDomainFailure, try: () => operation(ctx) })
  })
}
