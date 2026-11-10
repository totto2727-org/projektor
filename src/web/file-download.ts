import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'

import { transferCoreBinary } from './core-binary'
import { type PageFailure, RequestServices } from './request'
import { ScopeError } from './server/errors'

const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Same-origin delivery keeps browser policy here and persistent authorization in Core. */
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
    if (scope.selection.kind !== 'workspace' && scope.selection.kind !== 'project')
      return yield* new ScopeError(403, 'Selected workspace is not accessible.')
    const stored = yield* transferCoreBinary(
      `/files/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(scope.selection.workspace.id)}`,
      { method: request.method },
    )
    const contentType = stored.headers.get('content-type') ?? 'application/octet-stream'
    const filename = yield* Effect.try({
      try: () => decodeURIComponent(stored.headers.get('x-projektor-filename') ?? 'download'),
      catch: () => new ScopeError(400, 'Invalid attachment filename.'),
    })
    const inline = INLINE_TYPES.has(contentType)
    const headers = {
      'content-type': inline ? contentType : 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[\r\n"\\]/g, '_')}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': 'private, no-store',
    }
    return request.method === 'HEAD'
      ? HttpServerResponse.empty({ status: 200, headers })
      : HttpServerResponse.fromWeb(new Response(stored.body, { headers }))
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
