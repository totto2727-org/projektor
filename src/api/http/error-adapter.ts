import { Predicate } from 'effect'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { CorePublicError } from 'projektor/core-client'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '#contracts/errors.ts'
import {
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_UNSUPPORTED_MEDIA_TYPE,
} from '#contracts/http-status.ts'
import type { HonoEnv } from '#types'

export const serviceErrToResponse = function serviceErrToResponse(httpContext: Context<HonoEnv>, err: unknown) {
  if (err instanceof CorePublicError) {
    if (Predicate.isNotNullish(err.retryAfter)) {
      httpContext.header('Retry-After', String(err.retryAfter))
    }
    const error = err.kind === 'validation' && Predicate.isNotNullish(err.details) ? err.details : err.message
    return httpContext.json(
      { error, ...(err.kind === 'validation' ? {} : err.details) },
      err.status as ContentfulStatusCode,
    )
  }
  if (err instanceof ValidationError) {
    return httpContext.json({ error: err.issues }, HTTP_BAD_REQUEST)
  }
  if (err instanceof NotFoundError) {
    /*
     * PROJ-490: structured not-found details (e.g. patch_wiki_page's currentHeadings)
     * are spread alongside `error`, same convention as ConflictError below.
     */
    return httpContext.json({ error: err.message, ...err.details }, HTTP_NOT_FOUND)
  }
  if (err instanceof ForbiddenError) {
    return httpContext.json({ error: err.message }, HTTP_FORBIDDEN)
  }
  if (err instanceof ConflictError) {
    /*
     * PROJ-484: structured conflicts (e.g. wiki's currentRevisionId + diff) are
     * spread alongside `error` so REST callers get them as plain top-level fields.
     */
    return httpContext.json({ error: err.message, ...err.details }, HTTP_CONFLICT)
  }
  if (err instanceof PayloadTooLargeError) {
    return httpContext.json({ error: err.message }, HTTP_PAYLOAD_TOO_LARGE)
  }
  if (err instanceof UnsupportedMediaTypeError) {
    return httpContext.json({ error: err.message }, HTTP_UNSUPPORTED_MEDIA_TYPE)
  }
  throw err
}
