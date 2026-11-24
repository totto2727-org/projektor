import { Predicate, Schema } from 'effect'

import { getAttachmentForDownload, storageQuotaBytes, uploadStoredAttachment } from '#commands/files.ts'
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_SERVER_ERROR, HTTP_NOT_FOUND } from '#contracts/http-status.ts'

import { CoreActor, resolveCoreServiceCtx } from './authorization.ts'
import { CORE_ACTOR_HEADER, coreFailure, CorePublicError } from './contract.ts'
import { publicDomainFailure } from './domain-errors.ts'
import type { CoreEnvironment } from './environment.ts'

/** Only file bytes use native fetch. No external request is forwarded to a Hono router. */
export const handleCoreFileRequest = async function handleCoreFileRequest(
  request: Request,
  env: CoreEnvironment,
): Promise<Response> {
  try {
    const url = new URL(request.url)
    const download = /^\/files\/([^/]+)$/.exec(url.pathname)
    const upload = url.pathname === '/files' && request.method === 'POST'
    if (!download && !upload) {
      return new Response('Not found', { status: 404 })
    }
    if (download && request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { headers: { allow: 'GET, HEAD' }, status: 405 })
    }
    let actor: CoreActor
    try {
      actor = Schema.decodeUnknownSync(Schema.fromJsonString(CoreActor))(request.headers.get(CORE_ACTOR_HEADER))
    } catch {
      throw coreFailure(HTTP_BAD_REQUEST, 'Invalid file request')
    }
    const workspaceIds = url.searchParams.getAll('workspaceId')
    if (workspaceIds.length !== 1 || !workspaceIds[0]) {
      throw coreFailure(HTTP_BAD_REQUEST, 'Workspace not specified')
    }
    const ctx = await resolveCoreServiceCtx(actor, workspaceIds[0], upload ? 'write' : 'read', env)
    if (upload) {
      const form = await request.formData().catch(() => null)
      if (!form) {
        throw coreFailure(HTTP_BAD_REQUEST, 'Expected multipart/form-data')
      }
      const file = form.get('file')
      const entityType = form.get('entity_type') ?? form.get('entityType')
      const entityId = form.get('entity_id') ?? form.get('entityId')
      if (!(file instanceof File)) {
        throw coreFailure(HTTP_BAD_REQUEST, 'Missing file field')
      }
      if (entityType !== 'issue' && entityType !== 'wiki_page') {
        throw coreFailure(HTTP_BAD_REQUEST, 'entityType must be issue or wiki_page')
      }
      if (!Predicate.isString(entityId) || !entityId) {
        throw coreFailure(HTTP_BAD_REQUEST, 'entityId is required')
      }
      return Response.json(await uploadStoredAttachment(ctx, { file, entityType, entityId }, storageQuotaBytes(env)), {
        status: 201,
      })
    }
    let id: string
    try {
      id = decodeURIComponent(download![1])
    } catch {
      throw coreFailure(HTTP_BAD_REQUEST, 'Invalid attachment identifier')
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
    if (!object) {
      throw coreFailure(HTTP_NOT_FOUND, 'Object missing from storage')
    }
    // The native binding transports the R2 stream with cancellation and backpressure intact.
    return new Response(object.body, { headers })
  } catch (error) {
    const selected = publicDomainFailure(error)
    const problem =
      selected instanceof CorePublicError
        ? selected
        : coreFailure(HTTP_INTERNAL_SERVER_ERROR, 'An unexpected error occurred.')
    if (!(selected instanceof CorePublicError)) {
      console.error('[core]', { operation: 'fileTransfer', occurrenceId: problem.occurrenceId, cause: error })
    }
    return Response.json(
      { error: problem.message, occurrenceId: problem.occurrenceId },
      {
        headers: { 'cache-control': 'private, no-store' },
        status: problem.status,
      },
    )
  }
}
