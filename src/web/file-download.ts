import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import { getStoredAttachment, INLINE_TYPES } from '#commands/files'

import { type PageFailure, RequestServices } from './request'
import { runCommand } from './server/command-context'
import { ScopeError } from './server/errors'

/** Same-origin file delivery, with authorization before direct shared D1/R2 access. */
export function downloadFile(
  request: Request,
): Effect.Effect<HttpServerResponse.HttpServerResponse, PageFailure, RequestServices> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const url = new URL(request.url)
    const match = /^\/api\/files\/([^/]+)$/.exec(url.pathname)
    if (!match) return yield* new ScopeError(404, 'Not found')
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return HttpServerResponse.empty({
        status: 405,
        headers: { allow: 'GET, HEAD', 'cache-control': 'private, no-store' },
      })
    const workspaceHints = url.searchParams.getAll('workspace')
    if (new Set(workspaceHints).size > 1) return yield* new ScopeError(400, 'Ambiguous workspace parameter.')
    const workspaceHint = workspaceHints[0]
    const id = yield* Effect.try({
      try: () => decodeURIComponent(match[1]),
      catch: () => new ScopeError(400, 'Invalid attachment identifier.'),
    })
    // A download target is not a page selector. Archived owners are not in the active catalog.
    const scope = yield* services.scope({ workspaceHint, projectHint: '', requireWorkspace: true })
    const stored = yield* runCommand({ scope, ...(workspaceHint ? { workspaceSlug: workspaceHint } : {}) }, (ctx) =>
      getStoredAttachment(ctx, id),
    )
    if (!stored) return yield* new ScopeError(404, 'Object missing from storage')
    const inline = INLINE_TYPES.has(stored.contentType)
    const headers = {
      'content-type': inline ? stored.contentType : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${stored.filename.replace(/[\r\n"\\]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': 'private, no-store',
    }
    return request.method === 'HEAD'
      ? HttpServerResponse.empty({ status: 200, headers })
      : HttpServerResponse.uint8Array(new Uint8Array(stored.body), { headers })
  }).pipe(
    Effect.catchTags({
      ApiError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            {
              status: error.status,
              headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
            },
          ),
        ),
      ScopeError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: error.message },
            {
              status: error.status,
              headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
            },
          ),
        ),
    }),
    Effect.map((response) =>
      request.method === 'HEAD'
        ? HttpServerResponse.empty({ status: response.status, headers: response.headers })
        : response,
    ),
  )
}
