import { Effect, Schema } from 'effect'

import type { ServiceCtx } from '#commands/types'
import { checkRateLimit } from '#services/request-rate-limit'

import { requireDataWorkspace } from '../../web/server/data-context'
import { assertSameOriginMutation } from '../../web/server/mutation'
import { coreFailure } from '../contract'
import { publicDomainFailure } from '../domain-errors'
import type { CoreEnvironment } from '../environment'
import { loadBrowserScope, nativeRequest, publicWebFailure } from './authentication'
import { BrowserCommandSchema, type BrowserCommand } from './command-contract'

/** Proof and selectors cross the binding. Storage capabilities are constructed only in Core. */
export function browserCommand<A>(
  env: CoreEnvironment,
  input: BrowserCommand,
  operation: (ctx: ServiceCtx) => Promise<A>,
) {
  return Effect.gen(function* () {
    const proof = yield* Schema.decodeUnknownEffect(BrowserCommandSchema)(input).pipe(
      Effect.mapError(() => coreFailure(400, 'Invalid browser command.')),
    )
    const request = nativeRequest(proof.request)
    yield* Effect.try({ try: () => assertSameOriginMutation(request), catch: publicWebFailure })
    const scope = yield* loadBrowserScope(env, proof.request, {
      workspaceHint: proof.workspaceSlug,
      projectHint: proof.projectId ?? '',
      requireWorkspace: true,
    })
    const workspace = yield* Effect.try({ try: () => requireDataWorkspace(scope), catch: publicWebFailure })
    if (workspace.slug !== proof.workspaceSlug) return yield* coreFailure(403, 'Selected workspace is not accessible.')
    const auth = scope.auth
    if (!auth || auth.kind !== 'human' || (auth.method !== 'access' && auth.method !== 'dev'))
      return yield* coreFailure(403, 'An interactive browser session is required.')
    const limited = yield* Effect.tryPromise({ try: () => checkRateLimit(request, env), catch: publicDomainFailure })
    if (limited) return yield* coreFailure(429, 'Too many requests', { retryAfter: limited.retryAfter })
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
    return yield* Effect.tryPromise({ try: () => operation(ctx), catch: publicDomainFailure })
  })
}
