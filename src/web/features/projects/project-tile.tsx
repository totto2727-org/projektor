import { Predicate } from 'effect'
import type { JSX } from 'react'

import { Card } from '@/components/ui/card.tsx'

import type { ProjectSummary } from './schemas.ts'

const badgeClass =
  'font-mono text-[0.7rem] font-medium px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted leading-6'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const ProjectTile = function ProjectTile({ project }: { project: ProjectSummary }): JSX.Element {
  const open = project.open_issue_count
  const backlog = project.backlog_issue_count
  const active = open - backlog
  const count = open === 0 ? 'No open issues' : backlog === 0 ? `${active} open` : `${active} open · ${backlog} backlog`
  const path = project.slug ? `/projects/view/${encodeURIComponent(project.slug)}` : '/projects/view'
  const renderProjectTileIdentity = (): JSX.Element => (
    <div className='flex items-center gap-2'>
      <span className='font-bold text-text-base text-base'>{project.name}</span>
      <span className={badgeClass}>{project.key}</span>
      {Predicate.isNotNullish(project.archived_at) && <span className={badgeClass}>Archived</span>}
    </div>
  )
  return (
    <Card interactive className={`shadow-xs${Predicate.isNotNullish(project.archived_at) ? ' opacity-60' : ''}`}>
      <a
        href={`${path}?${new URLSearchParams({ projectId: project.id, workspace: project.workspace_slug })}`}
        className='block no-underline'
      >
        {renderProjectTileIdentity()}
        <span className='text-xs text-text-muted'>{count}</span>
        {project.description && (
          <span className='text-sm text-text-muted overflow-hidden line-clamp-2'>{project.description}</span>
        )}
      </a>
    </Card>
  )
}
