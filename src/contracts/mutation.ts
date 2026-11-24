import { Effect } from 'effect'

import { ApiError } from './errors.ts'

const FORBIDDEN_STATUS = 403

/**
 * Native browser mutations require an explicit same-origin request.
 *
 * @param {Request} request The browser request to check.
 */
export const assertSameOriginMutation = function assertSameOriginMutation(request: Request): void {
  if (
    request.method === 'GET' ||
    request.method === 'HEAD' ||
    request.headers.get('origin') !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new ApiError('request', FORBIDDEN_STATUS, 'A same-origin mutation request is required.')
  }
}

export const checkSameOriginMutation = function checkSameOriginMutation(
  request: Request,
): Effect.Effect<void, ApiError> {
  return Effect.try({
    catch: (error) => {
      if (error instanceof ApiError) {
        return error
      }
      throw error
    },
    try: () => {
      assertSameOriginMutation(request)
    },
  })
}
