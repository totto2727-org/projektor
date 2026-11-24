import { Effect, Schema } from 'effect'

import type { ServiceCtx } from '#commands/types.ts'
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
) {
  return Effect.gen(function* () {
    const proof = yield* Schema.decodeUnknownEffect(BrowserCommandSchema)(input).pipe(
      Effect.mapError(() => coreFailure(400, 'Invalid browser command.')),
    )
    const request = nativeRequest(proof.request)
    yield* Effect.try({ catch: publicWebFailure, try: () => assertSameOriginMutation(request) })
    const scope = yield* loadBrowserScope(env, proof.request, {
      workspaceHint: proof.workspaceSlug,
      projectHint: proof.projectId ?? '',
      requireWorkspace: true,
    })
    const workspace = yield* Effect.try({ catch: publicWebFailure, try: () => requireDataWorkspace(scope) })
    if (workspace.slug !== proof.workspaceSlug) {
      return yield* coreFailure(403, 'Selected workspace is not accessible.')
    }
    const auth = scope.auth
    if (!auth || auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev')) {
      return yield* coreFailure(403, 'An interactive browser session is required.')
    }
    const limited = yield* Effect.tryPromise({ catch: publicDomainFailure, try: () => checkRateLimit(request, env) })
    if (limited) {
      return yield* coreFailure(429, 'Too many requests', { retryAfter: limited.retryAfter })
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
