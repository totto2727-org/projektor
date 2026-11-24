import { getSharedLogo } from '#commands/share.ts'
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_SERVER_ERROR, HTTP_NOT_FOUND } from '#contracts/http-status.ts'

import { coreFailure, CorePublicError } from './contract.ts'
import { publicDomainFailure } from './domain-errors.ts'
import type { CoreEnvironment } from './environment.ts'

/** Public share tokens are authorized by the domain operation, never by browser claims. */
export const handleSharedLogoRequest = async function handleSharedLogoRequest(
  request: Request,
  env: CoreEnvironment,
): Promise<Response | undefined> {
  const match = /^\/share-logo\/([^/]+)$/.exec(new URL(request.url).pathname)
  if (!match) {
    return undefined
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { headers: { allow: 'GET, HEAD' }, status: 405 })
  }
  try {
    let token: string
    try {
      token = decodeURIComponent(match[1])
    } catch {
      throw coreFailure(HTTP_BAD_REQUEST, 'Invalid logo address.')
    }
    const object = await getSharedLogo(env.DB, env.R2, token)
    if (!object) {
      throw coreFailure(HTTP_NOT_FOUND, 'No logo set')
    }
    if (request.method === 'HEAD') {
      await object.body.cancel()
    }
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    const selected = publicDomainFailure(error)
    const problem =
      selected instanceof CorePublicError
        ? selected
        : coreFailure(HTTP_INTERNAL_SERVER_ERROR, 'An unexpected error occurred.')
    if (!(selected instanceof CorePublicError)) {
      console.error('[core]', { operation: 'shareLogo', occurrenceId: problem.occurrenceId, cause: error })
    }
    return Response.json(
      { error: problem.message, occurrenceId: problem.occurrenceId },
      { headers: { 'cache-control': 'private, no-store' }, status: problem.status },
    )
  }
}
