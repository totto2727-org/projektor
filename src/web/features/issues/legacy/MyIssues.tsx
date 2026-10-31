'use client'
import { useState } from 'react'

import { formatIssueRef } from '../lib/issue-ref'
import { statusDisplayName } from '../lib/status'
import { issueUrl } from '../utils/issue-url'
import type { MyIssuesInitialData, ScopedIssue } from '../views/MyIssuesPage'
import { categoryColor, type Issue } from './board-utils'

const OPEN_CATEGORIES = new Set(['todo', 'in_progress', 'in_review'])
function getStoryPoints(issue: Issue): string | null {
  const field = (issue.customFields ?? []).find((f) => f.key === 'story_points')
  return field?.value ?? null
}

function spBadge(pts: string) {
  return (
    <span
      className='text-[0.68rem] text-text-muted bg-surface border border-border rounded-[3px]
				px-[0.3rem] font-semibold whitespace-nowrap leading-[1.6]'
    >
      {pts} SP
    </span>
  )
}

function priorityBadge(issue: Issue) {
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

function isVisible(issue: Issue, includeDone: boolean): boolean {
  return includeDone ? true : OPEN_CATEGORIES.has(issue.status_category ?? '')
}

function statusBadge(issue: Issue) {
  return (
    <span className='font-medium text-sm' style={{ color: categoryColor(issue.status_category) }}>
      {statusDisplayName(issue.status_name, issue.status_key)}
    </span>
  )
}

interface ProjectGroup {
  name: string
  issues: ScopedIssue[]
}

function groupIssuesByProject(visible: readonly ScopedIssue[]): {
  order: string[]
  byProject: Map<string, ProjectGroup>
} {
  const order: string[] = []
  const byProject = new Map<string, ProjectGroup>()
  for (const issue of visible) {
    const key = `${issue.workspaceSlug}:${issue.project_key ?? '__none__'}`
    const name = issue.project_name ?? issue.project_key ?? 'No project'
    let group = byProject.get(key)
    if (!group) {
      group = { name, issues: [] }
      byProject.set(key, group)
      order.push(key)
    }
    group.issues.push(issue)
  }
  return { order, byProject }
}

function ProjectIssuesSection({ name, issues }: { name: string; issues: ScopedIssue[] }) {
  return (
    <section>
      <h2 className='text-sm font-semibold text-text-muted uppercase tracking-[0.05em] mb-2 pb-1 border-b border-border'>
        {name}
      </h2>

      {/* Desktop table */}
      <div className='overflow-x-auto max-sm:hidden'>
        <table className='w-full border-collapse text-[0.9rem]'>
          <thead>
            <tr className='bg-surface'>
              <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
                #
              </th>
              <th className='text-left px-3 py-2 border-b-2 border-border font-semibold w-full text-text-base'>
                Title
              </th>
              <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
                Priority
              </th>
              <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => {
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
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>
        {issues.map((issue) => (
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
            <div className='flex gap-[0.375rem] flex-wrap items-center'>
              {priorityBadge(issue)}
              {statusBadge(issue)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function MyIssues({ initialData }: { initialData: MyIssuesInitialData }) {
  const issues = initialData.issues
  const [includeDone, setIncludeDone] = useState(false)
  const visible = issues.filter((i) => isVisible(i, includeDone))
  const { order: projectOrder, byProject } = groupIssuesByProject(visible)
  const hasAny = visible.length > 0

  return (
    <div>
      <div className='flex items-center gap-3 mb-5'>
        <label className='flex items-center gap-2 text-sm text-text-muted cursor-pointer select-none'>
          <input
            type='checkbox'
            checked={includeDone}
            onChange={(e) => setIncludeDone((e.target as HTMLInputElement).checked)}
            className='accent-accent w-4 h-4'
          />
          Include done
        </label>
        <span className='text-sm text-text-muted'>
          {visible.length} issue{visible.length !== 1 ? 's' : ''}
        </span>
      </div>

      {!hasAny ? (
        <div className='text-center py-16 text-text-muted'>
          <p className='text-lg font-medium mb-1'>No issues assigned to you</p>
          <p className='text-sm'>
            {includeDone
              ? 'You have no issues across any project.'
              : 'You have no open issues. Toggle "Include done" to see completed ones.'}
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-8'>
          {projectOrder.map((key) => {
            const group = byProject.get(key)
            if (!group) return null
            return <ProjectIssuesSection key={key} name={group.name} issues={group.issues} />
          })}
        </div>
      )}
    </div>
  )
}
