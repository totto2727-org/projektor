'use client'
import { useState } from 'react'

import { FunctionError, unwrapResult } from '../../../client/functions'
import { updateIssue } from '../actions'
import { formatIssueRef } from '../lib/issue-ref'
import { issueUrl } from '../utils/issue-url'
import type { IssueDetailInitialData } from '../views/IssueDetailPage'
import type { Attachment, Comment, IssueData, IssueLink, Member, TaskStatus, TaskType } from './issue-detail-helpers'
import {
  AttachmentsSection,
  BodySection,
  ChildIssuesSection,
  CommentsSection,
  ParentBadge,
  RefChip,
  RelationsSection,
  ShareButton,
  SidebarPanel,
  TitleSection,
} from './IssueDetailParts'

function useIssueMutations(issueId: string, workspaceSlug: string) {
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [updatingPriority, setUpdatingPriority] = useState(false)
  const [updatingAssignee, setUpdatingAssignee] = useState(false)
  const [updatingType, setUpdatingType] = useState(false)
  const [typeChangeError, setTypeChangeError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)

  async function changeStatus(statusId: string) {
    setUpdatingStatus(true)
    setMutationError(null)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { statusId } }))
    } catch (cause) {
      setMutationError(`Status update failed: ${String(cause)}`)
    } finally {
      setUpdatingStatus(false)
    }
  }
  async function changePriority(priority: string) {
    setUpdatingPriority(true)
    setMutationError(null)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { priority } }))
    } catch (cause) {
      setMutationError(`Priority update failed: ${String(cause)}`)
    } finally {
      setUpdatingPriority(false)
    }
  }
  async function changeType(typeId: string) {
    setUpdatingType(true)
    setTypeChangeError(null)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { typeId: typeId || null } }))
    } catch (cause) {
      setTypeChangeError(cause instanceof FunctionError ? cause.message : String(cause))
    } finally {
      setUpdatingType(false)
    }
  }
  async function changeAssignee(assigneeId: string) {
    setUpdatingAssignee(true)
    setMutationError(null)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { assigneeId: assigneeId || null } }))
    } catch (cause) {
      setMutationError(`Assignee update failed: ${String(cause)}`)
    } finally {
      setUpdatingAssignee(false)
    }
  }
  return {
    updatingStatus,
    updatingPriority,
    updatingAssignee,
    updatingType,
    typeChangeError,
    mutationError,
    changeStatus,
    changePriority,
    changeAssignee,
    changeType,
  }
}

function IssueBreadcrumb({ issue, backHref }: { issue: IssueData; backHref: string | null }) {
  return (
    <nav className='text-sm text-text-muted mb-5'>
      {issue.type_key === 'epic' ? (
        <a href={backHref ?? '/epics'} className='text-text-muted no-underline'>
          ← Epics
        </a>
      ) : (
        <a
          href={backHref ?? `/issues${issue.project_key ? `?project=${issue.project_key}` : ''}`}
          className='text-text-muted no-underline'
        >
          ← Issues
        </a>
      )}
    </nav>
  )
}

function IssueDetailView(
  props: Readonly<{
    issue: IssueData
    issueId: string
    workspaceSlug?: string
    backHref: string | null
    issueRef: string
    copyUrl: string
    blockedByLinks: IssueLink[]
    parentEpic: IssueData | null
    childIssues: IssueData[]
    links: IssueLink[]
    attachments: Attachment[]
    comments: Comment[]
    currentUserId: string | null
    statuses: TaskStatus[]
    taskTypes: TaskType[]
    members: Member[]
    updatingStatus: boolean
    updatingPriority: boolean
    updatingAssignee: boolean
    updatingType: boolean
    typeChangeError: string | null
    changeStatus: (statusId: string) => void
    changePriority: (priority: string) => void
    changeAssignee: (assigneeId: string) => void
    changeType: (typeId: string) => void
  }>,
) {
  const { issue, issueId, workspaceSlug } = props
  return (
    <article className='max-w-[900px] mx-auto'>
      <IssueBreadcrumb issue={issue} backHref={props.backHref} />

      {/* Blocked-by banner */}
      {props.blockedByLinks.length > 0 && (
        <div
          role='alert'
          className='mb-4 px-[0.875rem] py-2 bg-warning-bg border border-warning-border
						rounded-md text-sm text-text-base flex items-center gap-2'
        >
          <span>⚠</span>
          <span>
            Blocked by {props.blockedByLinks.length} issue
            {props.blockedByLinks.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Issue header */}
      <header className='mb-6'>
        <div className='flex items-center gap-2 mb-3 flex-wrap'>
          <RefChip issueRef={props.issueRef} copyUrl={props.copyUrl} />
          <ShareButton issueId={issueId} workspaceSlug={workspaceSlug} />
          {issue.type_name && (
            <span
              className='inline-flex items-center px-2 py-[0.125rem] rounded bg-surface border
								border-border text-xs font-medium text-text-muted'
            >
              {issue.type_name}
            </span>
          )}
          <ParentBadge parentEpic={props.parentEpic} />
        </div>

        <TitleSection issue={issue} issueId={issueId} workspaceSlug={workspaceSlug} />
      </header>

      {/* Two-column body */}
      <div className='flex gap-8 items-start max-sm:flex-col'>
        {/* ── Main column ── */}
        <div className='flex-1 min-w-0 max-sm:w-full'>
          <BodySection
            issue={issue}
            issueId={issueId}
            workspaceSlug={workspaceSlug}
            currentUserId={props.currentUserId}
          />

          <ChildIssuesSection issue={issue} childIssues={props.childIssues} />

          <RelationsSection issueId={issueId} workspaceSlug={workspaceSlug} links={props.links} />

          <AttachmentsSection issueId={issueId} workspaceSlug={workspaceSlug} attachments={props.attachments} />

          <CommentsSection
            issueId={issueId}
            workspaceSlug={workspaceSlug}
            comments={props.comments}
            currentUserId={props.currentUserId}
          />
        </div>

        {/* ── Sidebar ── */}
        <SidebarPanel
          issue={issue}
          issueId={issueId}
          workspaceSlug={workspaceSlug}
          statuses={props.statuses}
          taskTypes={props.taskTypes}
          members={props.members}
          updatingStatus={props.updatingStatus}
          updatingPriority={props.updatingPriority}
          updatingAssignee={props.updatingAssignee}
          updatingType={props.updatingType}
          typeChangeError={props.typeChangeError}
          changeStatus={props.changeStatus}
          changePriority={props.changePriority}
          changeAssignee={props.changeAssignee}
          changeType={props.changeType}
        />
      </div>
    </article>
  )
}

export default function IssueDetail({
  workspaceSlug,
  initialData,
}: {
  workspaceSlug: string
  initialData: IssueDetailInitialData
}) {
  const issue = initialData.issue
  const comments = [...initialData.comments]
  const links = [...initialData.links]
  const attachments = [...initialData.attachments]
  const issueId = initialData.issue.id
  const statuses = [...initialData.statuses],
    taskTypes = [...initialData.taskTypes],
    members = [...initialData.members]
  const mutations = useIssueMutations(issueId, workspaceSlug)
  const error = mutations.mutationError
  const copyUrl = issueUrl(issue.project_key, issue.number, issue.title, issue.id, workspaceSlug)
  const params = new URLSearchParams({ workspace: workspaceSlug })
  if (initialData.issue.project_id) params.set('projectId', initialData.issue.project_id)
  const backHref = `${issue.type_key === 'epic' ? '/epics' : '/issues'}?${params}`
  return (
    <>
      {error && (
        <p role='alert' className='text-danger-text'>
          {error}
        </p>
      )}
      <IssueDetailView
        issue={issue}
        issueId={issueId}
        workspaceSlug={workspaceSlug}
        backHref={backHref}
        issueRef={formatIssueRef(issue.project_key, issue.number)}
        copyUrl={copyUrl}
        blockedByLinks={links.filter((entry) => entry.type === 'blocked_by')}
        parentEpic={initialData.parent}
        childIssues={[...initialData.children]}
        links={links}
        attachments={attachments}
        comments={comments}
        currentUserId={initialData.currentUserId}
        statuses={statuses}
        taskTypes={taskTypes}
        members={members}
        {...mutations}
      />
    </>
  )
}
