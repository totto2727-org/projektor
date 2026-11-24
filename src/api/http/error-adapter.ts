import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { CorePublicError } from 'projektor/core-client'

import type { HonoEnv } from '#types'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../../contracts/errors.ts'

export function serviceErrToResponse(httpContext: Context<HonoEnv>, err: unknown) {
  if (err instanceof CorePublicError) {
    if (err.retryAfter !== undefined) {
      httpContext.header('Retry-After', String(err.retryAfter))
    }
    const error = err.kind === 'validation' && err.details !== undefined ? err.details : err.message
    return httpContext.json(
      { error, ...(err.kind === 'validation' ? {} : err.details) },
      err.status as ContentfulStatusCode,
    )
  }
  if (err instanceof ValidationError) {
    return httpContext.json({ error: err.issues }, 400)
  }
  if (err instanceof NotFoundError) {
    /*
     * PROJ-490: structured not-found details (e.g. patch_wiki_page's currentHeadings)
     * are spread alongside `error`, same convention as ConflictError below.
     */
    return httpContext.json({ error: err.message, ...err.details }, 404)
  }
  if (err instanceof ForbiddenError) {
    return httpContext.json({ error: err.message }, 403)
  }
  if (err instanceof ConflictError) {
    /*
     * PROJ-484: structured conflicts (e.g. wiki's currentRevisionId + diff) are
     * spread alongside `error` so REST callers get them as plain top-level fields.
     */
    return httpContext.json({ error: err.message, ...err.details }, 409)
  }
  if (err instanceof PayloadTooLargeError) {
    return httpContext.json({ error: err.message }, 413)
  }
  if (err instanceof UnsupportedMediaTypeError) {
    return httpContext.json({ error: err.message }, 415)
  }
  throw err
}
