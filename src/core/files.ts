import { Schema } from 'effect'

import { getAttachmentForDownload, storageQuotaBytes, uploadStoredAttachment } from '#commands/files'

import { CoreActor, resolveCoreServiceCtx } from './authorization'
import { CORE_ACTOR_HEADER, coreFailure, CorePublicError } from './contract'
import { publicDomainFailure } from './domain-errors'
import type { CoreEnvironment } from './environment'

/** Only file bytes use native fetch. No external request is forwarded to a Hono router. */
export async function handleCoreFileRequest(request: Request, env: CoreEnvironment): Promise<Response> {
  try {
    const url = new URL(request.url)
    const download = /^\/files\/([^/]+)$/.exec(url.pathname)
    const upload = url.pathname === '/files' && request.method === 'POST'
    if (!download && !upload) return new Response('Not found', { status: 404 })
    if (download && request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    let actor: CoreActor
    try {
      actor = Schema.decodeUnknownSync(Schema.fromJsonString(CoreActor))(request.headers.get(CORE_ACTOR_HEADER))
    } catch {
      throw coreFailure(400, 'Invalid file request')
    }
    const workspaceIds = url.searchParams.getAll('workspaceId')
    if (workspaceIds.length !== 1 || !workspaceIds[0]) throw coreFailure(400, 'Workspace not specified')
    const ctx = await resolveCoreServiceCtx(actor, workspaceIds[0], upload ? 'write' : 'read', env)
    if (upload) {
      const form = await request.formData()
      const file = form.get('file')
      const entityType = form.get('entity_type') ?? form.get('entityType')
      const entityId = form.get('entity_id') ?? form.get('entityId')
      if (
        !(file instanceof File) ||
        (entityType !== 'issue' && entityType !== 'wiki_page') ||
        typeof entityId !== 'string'
      ) {
        throw coreFailure(400, 'Invalid upload request')
      }
      return Response.json(await uploadStoredAttachment(ctx, { file, entityType, entityId }, storageQuotaBytes(env)))
    }
    let id: string
    try {
      id = decodeURIComponent(download![1])
    } catch {
      throw coreFailure(400, 'Invalid attachment identifier')
    }
    const metadata = await getAttachmentForDownload(ctx, id)
    const headers = {
      'content-type': metadata.contentType,
      'x-projektor-filename': encodeURIComponent(metadata.filename),
      'cache-control': 'private, no-store',
    }
    if (request.method === 'HEAD') {
      const object = await env.R2.head(metadata.r2Key)
      return object ? new Response(null, { headers }) : new Response(null, { status: 404 })
    }
    const object = await env.R2.get(metadata.r2Key)
    if (!object) throw coreFailure(404, 'Object missing from storage')
    // The native binding transports the R2 stream with cancellation and backpressure intact.
    return new Response(object.body, { headers })
  } catch (cause) {
    const selected = publicDomainFailure(cause)
    const problem = selected instanceof CorePublicError ? selected : coreFailure(500, 'An unexpected error occurred.')
    if (!(selected instanceof CorePublicError))
      console.error('[core]', { operation: 'fileTransfer', occurrenceId: problem.occurrenceId, cause })
    return Response.json(
      { error: problem.message, occurrenceId: problem.occurrenceId },
      {
        status: problem.status,
        headers: { 'cache-control': 'private, no-store' },
      },
    )
  }
}
