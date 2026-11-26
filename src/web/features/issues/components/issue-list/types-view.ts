import type { Issue, SortKey, TaskStatus } from '@/features/issues/components/board-utils.ts'

export type ViewMode = 'list' | 'board' | 'backlog'

export interface IssueListRowsProps {
  issues: Issue[]
  statuses: TaskStatus[]
  updatingId: string | undefined
  updatingPriorityId: string | undefined
  changeStatus: (issueId: string, statusId: string) => void
  changePriority: (issueId: string, priority: string) => void
}

export interface IssueListTableProps extends IssueListRowsProps {
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}
