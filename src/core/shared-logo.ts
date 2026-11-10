import { getSharedLogo } from '#commands/share'

import { coreFailure, CorePublicError } from './contract'
import { publicDomainFailure } from './domain-errors'
import type { CoreEnvironment } from './environment'

/** Public share tokens are authorized by the domain operation, never by browser claims. */
export async function handleSharedLogoRequest(request: Request, env: CoreEnvironment): Promise<Response | undefined> {
  const match = /^\/share-logo\/([^/]+)$/.exec(new URL(request.url).pathname)
  if (!match) return undefined
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  try {
    let token: string
    try {
      token = decodeURIComponent(match[1])
    } catch {
      throw coreFailure(400, 'Invalid logo address.')
    }
    const object = await getSharedLogo(env.DB, env.R2, token)
    if (!object) throw coreFailure(404, 'No logo set')
    if (request.method === 'HEAD') await object.body.cancel()
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (cause) {
    const selected = publicDomainFailure(cause)
    const problem = selected instanceof CorePublicError ? selected : coreFailure(500, 'An unexpected error occurred.')
    if (!(selected instanceof CorePublicError))
      console.error('[core]', { operation: 'shareLogo', occurrenceId: problem.occurrenceId, cause })
    return Response.json(
      { error: problem.message, occurrenceId: problem.occurrenceId },
      { status: problem.status, headers: { 'cache-control': 'private, no-store' } },
    )
  }
}
