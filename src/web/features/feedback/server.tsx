import { Effect } from 'effect'

import { browserRequest, coreResult } from '../../core'
import { RequestServices } from '../../request'
import { ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { FeedbackDetailClient } from './FeedbackDetailClient'
import { FeedbackGridClient } from './FeedbackGridClient'
import { FeedbackIndexSchema, FeedbackDetailSchema } from './schemas'

function NeedProject() {
  return (
    <section className='p-6 bg-surface border border-border rounded-lg'>
      <h1 className='m-0'>Choose a project</h1>
      <p className='text-text-muted'>Feedback sources are managed within a project.</p>
    </section>
  )
}
function NotFound() {
  return (
    <section className='p-6 text-center text-text-muted bg-surface rounded-lg border border-border'>
      Feedback source not found.
    </section>
  )
}
export function renderFeedback(scope: RequestScope, _url: URL) {
  return Effect.gen(function* () {
    if (scope.selection.kind !== 'project') return <NeedProject />
    const { project, workspace } = scope.selection
    if (workspace.role !== 'owner' && workspace.role !== 'admin')
      return yield* new ScopeError(403, 'Insufficient permissions')
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
export function renderFeedbackDetail(
  scope: RequestScope,
  url: URL,
  params: Readonly<Record<string, string | undefined>> = {},
) {
  return Effect.gen(function* () {
    const sourceId = params.sourceId ?? url.searchParams.get('sourceId') ?? url.searchParams.get('id')
    if (!sourceId) return <NotFound />
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
    if (!data) return <NotFound />
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
