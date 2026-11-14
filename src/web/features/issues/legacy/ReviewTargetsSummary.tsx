import type { ReviewTarget } from '../../../../contracts/review-targets'
import { issueUrl } from '../utils/issue-url'

interface ReviewableIssue {
  id: string
  number: number
  title: string
  project_key: string | null
  workspaceSlug?: string
  reviewTargets: readonly ReviewTarget[]
}

const STATUS_LABELS = {
  fixing: '修正中',
  in_review: 'レビュー中',
  changes_requested: '要修正',
  done: '完了',
}

/** One native link keeps review context visible in every issue layout, including empty selection. */
export function ReviewTargetsSummary({ issue }: { issue: ReviewableIssue }) {
  const targets = issue.reviewTargets.filter((entry) => entry.status !== 'done')
  const target = targets.find((entry) => entry.status === 'in_review') ?? targets[0]
  const needsReview = target?.status === 'in_review'
  const label = target ? target.filename || target.url || 'File' : '対象なし'
  const url = new URL(
    issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug),
    'https://frontend.invalid',
  )
  url.searchParams.set('tab', 'review-targets')
  const href = `${url.pathname}${url.search}${url.hash}`
  const additional = targets.length > 1 ? ` +${targets.length - 1}` : ''

  return (
    <a
      href={href}
      aria-label={`Review targets: ${label}${additional}${target ? ` (${STATUS_LABELS[target.status]})` : ''}`}
      className={`mt-2 flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1 text-xs no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        needsReview ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-surface text-text-muted'
      }`}
    >
      <span className='shrink-0 font-medium'>Review targets</span>
      <span className='min-w-0 max-w-48 truncate' title={label}>
        {label}
      </span>
      {additional && <span className='shrink-0 font-semibold'>{additional.trim()}</span>}
      {target && <span className='shrink-0'>{STATUS_LABELS[target.status]}</span>}
      {target && !needsReview && <span className='shrink-0'>レビュー不要</span>}
    </a>
  )
}
