import { Schema } from 'effect'

import { type ReviewFilter, ReviewFilterSchema } from '../../../../contracts/review-targets'
import type { ProjectSummary } from '../../../server/request-context'
import type { IssuesRoute } from './IssuesPage'

const REVIEW_LINKS = [
  { review: null, label: 'All issues' },
  { review: 'in_review', label: 'レビュー中' },
  { review: 'fixing', label: '修正中' },
  { review: 'changes_requested', label: '要修正' },
  { review: 'active', label: '未完了の対象' },
] satisfies { review: ReviewFilter | null; label: string }[]

/** Native links keep review scope canonical on the server, including without JavaScript. */
export function IssueReviewNavigation({
  route,
  workspaceSlug,
  project,
}: {
  route: IssuesRoute
  workspaceSlug: string
  project: ProjectSummary | null
}) {
  const params = new URLSearchParams(route.search)
  const requestedReview = params.get('review')
  const currentReview = Schema.is(ReviewFilterSchema)(requestedReview) ? requestedReview : null
  const workspaceReviewHref = `/issues?${new URLSearchParams({ workspace: workspaceSlug, review: 'in_review', view: 'list' })}`

  function href(review: ReviewFilter | null) {
    const next = new URLSearchParams(params)
    next.set('workspace', workspaceSlug)
    next.delete('cursor')
    if (review) {
      next.set('review', review)
      next.set('view', 'list')
    } else next.delete('review')
    return `${route.pathname}?${next}`
  }

  return (
    <div className='mb-6 min-w-0'>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <p className='m-0 text-sm font-medium text-text-base'>
          {project ? `表示範囲: ${project.key} · ${project.name}` : '表示範囲: アクセスできる全プロジェクト'}
        </p>
        {project && (
          <a href={workspaceReviewHref} className='inline-flex min-h-[44px] items-center text-sm text-accent underline'>
            全プロジェクトのレビュー
          </a>
        )}
      </div>
      <nav aria-label='レビューステータスで課題を絞り込む' className='flex flex-wrap gap-2'>
        {REVIEW_LINKS.map((entry) => {
          const active = entry.review === currentReview
          return (
            <a
              key={entry.review ?? 'all'}
              href={href(entry.review)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-md border px-3 py-2 text-sm no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? 'border-accent bg-surface text-accent font-semibold' : 'border-border text-text-muted'}`}
            >
              {entry.label}
            </a>
          )
        })}
      </nav>
    </div>
  )
}
