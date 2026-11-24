import { Effect } from 'effect'

import { ApiError } from './errors.ts'

/** Native browser mutations require an explicit same-origin request. */
export const assertSameOriginMutation = function assertSameOriginMutation(request: Request): void {
  if (
    request.method === 'GET' ||
    request.method === 'HEAD' ||
    request.headers.get('origin') !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  ) {
    throw new ApiError('request', 403, 'A same-origin mutation request is required.')
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
    try: () => assertSameOriginMutation(request),
  })
}
