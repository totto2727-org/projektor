'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { hasSingleItem } from '#contracts/item-count.ts'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { statusDisplayName } from '@/features/issues/lib/status.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'
import type { MyIssuesInitialData, ScopedIssue } from '@/features/issues/views/my-issues-page.tsx'

import { categoryColor } from './board-utils.ts'
import type { Issue } from './board-utils.ts'
import { ReviewTargetsSummary } from './review-targets-summary.tsx'

const IN_REVIEW_ORDER = 0
const IN_PROGRESS_ORDER = 1
const TODO_ORDER = 2
const BACKLOG_ORDER = 3
const UNKNOWN_STATUS_ORDER = 4
const URGENT_ORDER = 0
const HIGH_ORDER = 1
const MEDIUM_ORDER = 2
const LOW_ORDER = 3
const NONE_ORDER = 4
const UNKNOWN_PRIORITY_ORDER = 5

const OPEN_CATEGORIES = new Set(['todo', 'in_progress', 'in_review'])
const STATUS_ORDER = new Map([
  ['in_review', IN_REVIEW_ORDER],
  ['in_progress', IN_PROGRESS_ORDER],
  ['todo', TODO_ORDER],
  ['backlog', BACKLOG_ORDER],
])
const PRIORITY_ORDER = new Map([
  ['urgent', URGENT_ORDER],
  ['high', HIGH_ORDER],
  ['medium', MEDIUM_ORDER],
  ['low', LOW_ORDER],
  ['none', NONE_ORDER],
])

function statusOrder(issue: Issue): number {
  if (issue.status_key === 'backlog' || issue.status_key === 'in_review') {
    return STATUS_ORDER.get(issue.status_key) ?? UNKNOWN_STATUS_ORDER
  }
  return STATUS_ORDER.get(issue.status_category ?? '') ?? UNKNOWN_STATUS_ORDER
}

function compareIssues(issue: Issue, selectedIssue: Issue): number {
  return (
    statusOrder(issue) - statusOrder(selectedIssue) ||
    (PRIORITY_ORDER.get(issue.priority) ?? UNKNOWN_PRIORITY_ORDER) -
      (PRIORITY_ORDER.get(selectedIssue.priority) ?? UNKNOWN_PRIORITY_ORDER) ||
    selectedIssue.updated_at - issue.updated_at
  )
}
function getStoryPoints(issue: Issue): string | null {
  const field = (issue.customFields ?? []).find((selectedField) => selectedField.key === 'story_points')
  return field?.value ?? null
}

function spBadge(pts: string): JSX.Element {
  return (
    <span
      className='text-[0.68rem] text-text-muted bg-surface border border-border rounded-[3px]
				px-[0.3rem] font-semibold whitespace-nowrap leading-[1.6]'
    >
      {pts} SP
    </span>
  )
}

function priorityBadge(issue: Issue): JSX.Element {
  return (
    <span
      className='inline-flex items-center px-1.5 py-0.5 rounded text-[0.7rem] font-semibold capitalize whitespace-nowrap'
      style={{
        background: `var(--priority-${issue.priority}-bg, var(--priority-low-bg))`,
        color: `var(--priority-${issue.priority}-text, var(--text-muted))`,
      }}
    >
      {issue.priority === 'none' ? '–' : issue.priority}
    </span>
  )
}

function statusBadge(issue: Issue): JSX.Element {
  return (
    <span className='font-medium text-sm' style={{ color: categoryColor(issue.status_category) }}>
      {statusDisplayName(issue.status_name, issue.status_key)}
    </span>
  )
}

const renderMyIssueHead = (): JSX.Element => (
  <thead>
    <tr className='bg-surface'>
      <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>#</th>
      <th className='text-left px-3 py-2 border-b-2 border-border font-semibold w-full text-text-base'>Title</th>
      <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
        Priority
      </th>
      <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
        Status
      </th>
    </tr>
  </thead>
)

const renderMyIssueRow = (issue: ScopedIssue): JSX.Element => {
  const pts = getStoryPoints(issue)
  return (
    <tr key={issue.id} className='border-b border-border'>
      <td className='px-3 py-2 align-middle whitespace-nowrap'>
        <a
          href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
          className='text-text-muted font-mono text-[0.8rem] no-underline hover:underline focus:underline'
        >
          {formatIssueRef(issue.project_key, issue.number)}
        </a>
      </td>
      <td className='px-3 py-2 align-middle text-text-base'>
        <a
          href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
          className='text-text-base no-underline hover:underline focus:underline'
        >
          {issue.title}
        </a>
        <ReviewTargetsSummary issue={issue} />
      </td>
      <td className='px-3 py-2 align-middle whitespace-nowrap'>
        <div className='flex items-center gap-[0.375rem]'>
          {priorityBadge(issue)}
          {pts && spBadge(pts)}
        </div>
      </td>
      <td className='px-3 py-2 align-middle whitespace-nowrap'>{statusBadge(issue)}</td>
    </tr>
  )
}

const renderMyIssueCard = (issue: ScopedIssue): JSX.Element => (
  <div key={issue.id} className='py-3 px-4 border border-border rounded-md bg-surface'>
    <a
      href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
      className='inline-block font-mono text-[0.8rem] text-text-muted no-underline hover:underline focus:underline mb-1'
    >
      {formatIssueRef(issue.project_key, issue.number)}
    </a>
    <a
      href={issueUrl(issue.project_key, issue.number, issue.title, issue.id, issue.workspaceSlug)}
      className='no-underline'
    >
      <div className='text-[0.9rem] text-text-base font-medium mb-2'>{issue.title}</div>
    </a>
    <ReviewTargetsSummary issue={issue} />
    <div className='flex gap-[0.375rem] flex-wrap items-center'>
      {priorityBadge(issue)}
      {statusBadge(issue)}
    </div>
  </div>
)

const renderMyIssueBody = (issues: ScopedIssue[]): JSX.Element => (
  <tbody>{issues.map((issue) => renderMyIssueRow(issue))}</tbody>
)

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function IssuesTable({ issues }: { issues: ScopedIssue[] }): JSX.Element {
  return (
    <section>
      {/* Desktop table */}
      <div className='overflow-x-auto max-sm:hidden'>
        <table className='w-full border-collapse text-[0.9rem]'>
          {renderMyIssueHead()}
          {renderMyIssueBody(issues)}
        </table>
      </div>

      {/* Mobile cards */}
      <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>
        {issues.map((issue) => renderMyIssueCard(issue))}
      </div>
    </section>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function MyIssues({ initialData }: { initialData: MyIssuesInitialData }): JSX.Element {
  const visible = initialData.issues
    .filter((issue) => OPEN_CATEGORIES.has(issue.status_category ?? ''))
    .toSorted(compareIssues)
  const hasAny = Array.isArrayNonEmpty(visible)

  return (
    <div>
      <div className='flex items-center gap-3 mb-5'>
        <span className='text-sm text-text-muted'>
          {visible.length} issue{!hasSingleItem(visible) ? 's' : ''}
        </span>
      </div>

      {!hasAny ? (
        <div className='text-center py-16 text-text-muted'>
          <p className='text-lg font-medium mb-1'>No open issues assigned to you</p>
          <p className='text-sm'>You have no open issues across any project.</p>
        </div>
      ) : (
        <IssuesTable issues={visible} />
      )}
    </div>
  )
}
