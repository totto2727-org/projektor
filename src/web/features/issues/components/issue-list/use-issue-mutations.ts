'use client'
import { useState } from 'react'

import { unwrapResult } from '@/client/functions.ts'
import { updateIssue } from '@/features/issues/actions.ts'
import type { TaskStatus } from '@/features/issues/components/board-utils.ts'

interface IssueMutations {
  changePriority: (issueId: string, priority: string) => Promise<void>
  changeStatus: (issueId: string, statusId: string) => Promise<void>
  updateError: string | undefined
  updatingId: string | undefined
  updatingPriorityId: string | undefined
}

/**
 * Mutation proxies refresh canonical SSR rows, never rewrite a browser-owned row copy.
 *
 * @param {string | undefined} workspaceSlug Workspace selection forwarded to the server action.
 * @param {Readonly<TaskStatus[]>} statuses Valid targets for status changes.
 * @returns {IssueMutations} Mutation handlers, in-flight issue IDs and the last mutation error.
 */
export const useIssueMutations = function useIssueMutations(
  workspaceSlug: string | undefined,
  statuses: Readonly<TaskStatus[]>,
): IssueMutations {
  const [updatingId, setUpdatingId] = useState<string>()
  const [updatingPriorityId, setUpdatingPriorityId] = useState<string>()
  const [updateError, setUpdateError] = useState<string>()

  const changeStatus = async function changeStatus(issueId: string, statusId: string): Promise<void> {
    if (!statuses.some((status) => status.id === statusId)) {
      return
    }
    setUpdateError(undefined)
    setUpdatingId(issueId)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { statusId } }))
    } catch (error) {
      setUpdateError(`Status update failed: ${String(error)}`)
    }
    setUpdatingId(undefined)
  }

  const changePriority = async function changePriority(issueId: string, priority: string): Promise<void> {
    setUpdateError(undefined)
    setUpdatingPriorityId(issueId)
    try {
      unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { priority } }))
    } catch (error) {
      setUpdateError(`Priority update failed: ${String(error)}`)
    }
    setUpdatingPriorityId(undefined)
  }
  return { updatingId, updatingPriorityId, updateError, changeStatus, changePriority }
}
