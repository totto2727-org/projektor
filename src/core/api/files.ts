import { Predicate, Schema } from 'effect'

import { exportWiki } from '#commands/wiki-export.ts'
import { getWorkspaceLogoObject, uploadWorkspaceLogo } from '#commands/workspaces.ts'
import { CoreActor, resolveCoreServiceCtx } from '#core/authorization.ts'
import { CORE_ACTOR_HEADER, coreFailure, CorePublicError } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'

/** Binary branding and wiki exports use fetch. JSON operations remain named RPC. */
export const handleApiBinaryRequest = async function handleApiBinaryRequest(
  request: Request,
  env: CoreEnvironment,
): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (url.pathname !== '/workspace-logo' && url.pathname !== '/wiki-export') {
    return undefined
  }
  try {
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 })
    }
    if (url.pathname === '/wiki-export' && request.method !== 'GET') {
      return new Response(null, { status: 405 })
    }
    const actor = Schema.decodeUnknownSync(Schema.fromJsonString(CoreActor))(request.headers.get(CORE_ACTOR_HEADER))
    const ids = url.searchParams.getAll('workspaceId')
    if (ids.length !== 1 || !ids[0]) {
      throw coreFailure(400, 'Workspace not specified')
    }
    const ctx = await resolveCoreServiceCtx(actor, ids[0], request.method === 'POST' ? 'write' : 'read', env)
    if (url.pathname === '/wiki-export') {
      const { filename, stream } = await exportWiki(ctx, {
        scope: url.searchParams.get('scope') ?? undefined,
        projectId: url.searchParams.get('projectId') ?? undefined,
        pageId: url.searchParams.get('pageId') ?? undefined,
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename.replace(/[\r\n"\\]/gu, '_')}"`,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    if (request.method === 'POST') {
      const form = await request.formData().catch(() => null)
      if (!form) {
        throw coreFailure(400, 'Expected multipart/form-data')
      }
      const file = form.get('file')
      if (!(file instanceof File)) {
        throw coreFailure(400, 'Missing file field')
      }
      return Response.json(await uploadWorkspaceLogo(ctx, file), { status: 201 })
    }
    const object = await getWorkspaceLogoObject(ctx)
    if (!object) {
      throw coreFailure(404, 'No logo set')
    }
    if (request.method === 'HEAD') {
      await object.body.cancel()
    }
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    const mapped = publicDomainFailure(error)
    const problem = mapped instanceof CorePublicError ? mapped : coreFailure(500, 'An unexpected error occurred.')
    if (!(mapped instanceof CorePublicError)) {
      console.error('[core]', { operation: 'workspaceLogo', occurrenceId: problem.occurrenceId, error })
    }
    return Response.json(
      {
        error:
          problem.kind === 'validation' && Predicate.isNotNullish(problem.details) ? problem.details : problem.message,
        ...(problem.kind === 'validation' ? {} : problem.details),
      },
      { status: problem.status },
    )
  }
}
