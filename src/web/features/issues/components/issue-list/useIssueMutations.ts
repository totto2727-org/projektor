'use client'
import { useState } from 'react'

import { unwrapResult } from '@/client/functions.ts'
import { updateIssue } from '@/features/issues/actions.ts'
import type { TaskStatus } from '@/features/issues/components/board-utils.ts'

/** Mutation proxies refresh canonical SSR rows, never rewrite a browser-owned row copy. */
export function useIssueMutations(workspaceSlug: string | undefined, statuses: Readonly<TaskStatus[]>) {
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [updatingPriorityId, setUpdatingPriorityId] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const changeStatus = async function changeStatus(issueId: string, statusId: string): Promise<void> {
    if (!statuses.some((status) => status.id === statusId)) {
      return
    }
    setUpdateError(null)
    setUpdatingId(issueId)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { statusId } }))
    } catch (cause) {
      setUpdateError(`Status update failed: ${String(cause)}`)
    }
    setUpdatingId(null)
  }

  const changePriority = async function changePriority(issueId: string, priority: string): Promise<void> {
    setUpdateError(null)
    setUpdatingPriorityId(issueId)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { priority } }))
    } catch (cause) {
      setUpdateError(`Priority update failed: ${String(cause)}`)
    }
    setUpdatingPriorityId(null)
  }
  return { updatingId, updatingPriorityId, updateError, changeStatus, changePriority }
}
