'use client'
import type { RequestScope } from '../../../server/request-context.ts'
import IssueDetail from '../components/IssueDetail.tsx'
import type { Attachment, Comment, Issue, IssueLink, Member, Status, TaskType } from '../types.ts'
import { SelectionRequired } from './shared.tsx'
export interface IssueDetailInitialData {
  readonly issue: Issue
  readonly comments: Readonly<Comment[]>
  readonly links: Readonly<IssueLink[]>
  readonly attachments: Readonly<Attachment[]>
  readonly statuses: Readonly<Status[]>
  readonly taskTypes: Readonly<TaskType[]>
  readonly members: Readonly<Member[]>
  readonly parent: Issue | null
  readonly children: Readonly<Issue[]>
  readonly currentUserId: string
  readonly reviewTargetsFocused?: boolean
}
export function IssueDetailPage({
  scope,
  workspaceSlug,
  initialData,
}: {
  scope: RequestScope
  workspaceSlug: string
  initialData: IssueDetailInitialData | null
}) {
  if (!initialData) {
    return <SelectionRequired scope={scope} label='Issue' />
  }
  return (
    <IssueDetail
      key={`${scope.user.id}:${workspaceSlug}:${initialData.issue.id}`}
      workspaceSlug={workspaceSlug}
      initialData={initialData}
    />
  )
}
