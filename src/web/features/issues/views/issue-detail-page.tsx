'use client'
import type { JSX } from 'react'

import { IssueDetail } from '@/features/issues/components/issue-detail.tsx'
import type { Attachment, Comment, Issue, IssueLink, Member, Status, TaskType } from '@/features/issues/types.ts'
import type { RequestScope } from '@/server/request-context.ts'

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
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const IssueDetailPage = function IssueDetailPage({
  scope,
  workspaceSlug,
  initialData,
}: {
  scope: RequestScope
  workspaceSlug: string
  initialData: IssueDetailInitialData | null
}): JSX.Element {
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
