import type { JSX } from 'react'

import { firstNonEmptyText } from '#contracts/non-empty-text.ts'
import type { ReviewTarget } from '#contracts/review-targets.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'

interface ReviewableIssue {
  id: string
  number: number
  title: string
  project_key: string | null
  workspaceSlug?: string
  reviewTargets: Readonly<ReviewTarget[]>
}

const STATUS_LABELS = {
  changes_requested: '要修正',
  done: '完了',
  fixing: '修正中',
  in_review: 'レビュー中',
}
const VISIBLE_TARGET_COUNT = 1

/**
 * One native link keeps review context visible in every issue layout, including empty selection.
 *
 * @param {{ issue: ReviewableIssue }} props The issue identity, authorized workspace, and review targets.
 * @returns {JSX.Element} A link with the current review target summary and status.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const ReviewTargetsSummary = function ReviewTargetsSummary({ issue }: { issue: ReviewableIssue }): JSX.Element {
  const targets = issue.reviewTargets.filter((entry) => entry.status !== 'done')
  const target = targets.find((entry) => entry.status === 'in_review') ?? targets[0]
  const needsReview = target?.status === 'in_review'
  const label = target ? (firstNonEmptyText(target.filename, target.url) ?? 'File') : '対象なし'
  const url = new URL(
    issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug),
    'https://frontend.invalid',
  )
  url.searchParams.set('tab', 'review-targets')
  const href = `${url.pathname}${url.search}${url.hash}`
  const additional = targets.length > VISIBLE_TARGET_COUNT ? ` +${targets.length - VISIBLE_TARGET_COUNT}` : ''

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
