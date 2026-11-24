import { String, Predicate, Effect } from 'effect'
import type { JSX } from 'react'

import { HTTP_FORBIDDEN } from '#contracts/http-status.ts'
import { browserRequest, coreResult } from '@/core.ts'
import { RequestServices } from '@/request.ts'
import { ScopeError } from '@/server/errors.ts'
import type { RequestScope } from '@/server/request-context.ts'

import { FeedbackDetailClient } from './feedback-detail-client.tsx'
import { FeedbackGridClient } from './feedback-grid-client.tsx'
import { FeedbackIndexSchema, FeedbackDetailSchema } from './schemas.ts'

const NeedProject = function NeedProject(): JSX.Element {
  return (
    <section className='p-6 bg-surface border border-border rounded-lg'>
      <h1 className='m-0'>Choose a project</h1>
      <p className='text-text-muted'>Feedback sources are managed within a project.</p>
    </section>
  )
}
const NotFound = function NotFound(): JSX.Element {
  return (
    <section className='p-6 text-center text-text-muted bg-surface rounded-lg border border-border'>
      Feedback source not found.
    </section>
  )
}
export const renderFeedback = function renderFeedback(scope: RequestScope, _url: URL) {
  return Effect.gen(function* () {
    if (scope.selection.kind !== 'project') {
      return <NeedProject />
    }
    const { project, workspace } = scope.selection
    if (workspace.role !== 'owner' && workspace.role !== 'admin') {
      return yield* new ScopeError(HTTP_FORBIDDEN, 'Insufficient permissions')
    }
    const services = yield* RequestServices
    const { sources, summaries } = yield* coreResult(
      FeedbackIndexSchema,
      services.core.webFeedbackIndex(browserRequest(services.request), workspace.id, project.id),
    )
    return (
      <FeedbackGridClient
        key={`${workspace.slug}:${project.id}`}
        initialSources={sources}
        initialSummaries={summaries}
        projectId={project.id}
        workspaceSlug={workspace.slug}
      />
    )
  })
}
export const renderFeedbackDetail = function renderFeedbackDetail(
  scope: RequestScope,
  url: URL,
  params: Readonly<Record<string, string | undefined>> = {},
) {
  return Effect.gen(function* () {
    const sourceId = params.sourceId ?? url.searchParams.get('sourceId') ?? url.searchParams.get('id')
    if (Predicate.isNullish(sourceId) || String.isEmpty(sourceId)) {
      return <NotFound />
    }
    const services = yield* RequestServices
    const chosen =
      scope.selection.kind === 'workspace' || scope.selection.kind === 'project' ? scope.selection.workspace : null
    const data = yield* coreResult(
      FeedbackDetailSchema,
      services.core.webFeedbackDetail(
        browserRequest(services.request),
        sourceId,
        url.searchParams.get('status') ?? '',
        chosen?.id,
      ),
    )
    if (!data) {
      return <NotFound />
    }
    const tab = url.searchParams.get('tab')
    const initialTab = tab === 'summary' || tab === 'settings' ? tab : 'items'
    return (
      <FeedbackDetailClient
        key={`${data.workspaceSlug}:${sourceId}`}
        initialSource={data.source}
        initialSources={data.sources}
        initialRows={data.rows}
        initialSummary={data.summary}
        initialStatus={data.status}
        initialTab={initialTab}
        projectId={data.projectId}
        workspaceSlug={data.workspaceSlug}
      />
    )
  })
}
