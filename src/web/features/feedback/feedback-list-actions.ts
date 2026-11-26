import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { unwrapResult } from '@/client/functions.ts'

import {
  convertFeedbackToIssue,
  convertSelectedFeedbackToIssue,
  markFeedbackReviewed,
  markSelectedFeedbackReviewed,
} from './actions.ts'

export interface FeedbackStatusUpdate {
  ids: Readonly<string[]>
  status: string
}

interface FeedbackActionInputs {
  addOptimistic: (change: FeedbackStatusUpdate) => void
  projectId: string
  setError: (error: string) => void
  setSelected: (selected: Set<string>) => void
  startTransition: (action: () => Promise<void>) => void
  workspaceSlug: string | undefined
}

interface FeedbackActions {
  bulkConvertToIssue: (selection: Set<string>) => void
  bulkMarkReviewed: (selection: Set<string>) => void
  convert: (id: string) => void
  markReviewed: (id: string) => void
}

export const useFeedbackActions = function useFeedbackActions({
  addOptimistic,
  projectId,
  setError,
  setSelected,
  startTransition,
  workspaceSlug,
}: FeedbackActionInputs): FeedbackActions {
  const scope = fieldsInOrder([
    ['workspaceSlug', workspaceSlug],
    ['projectId', projectId],
  ])
  const convert = function convert(id: string): void {
    startTransition(async () => {
      addOptimistic({ ids: [id], status: 'actioned' })
      try {
        unwrapResult(await convertFeedbackToIssue({ ...scope, feedbackId: id }))
      } catch (error) {
        setError(globalThis.String(error))
      }
    })
  }
  const markReviewed = function markReviewed(id: string): void {
    startTransition(async () => {
      addOptimistic({ ids: [id], status: 'reviewed' })
      try {
        unwrapResult(await markFeedbackReviewed({ ...scope, feedbackId: id }))
      } catch (error) {
        setError(globalThis.String(error))
      }
    })
  }
  const bulkMarkReviewed = function bulkMarkReviewed(selected: Set<string>): void {
    startTransition(async () => {
      const feedbackIds = [...selected]
      addOptimistic({ ids: feedbackIds, status: 'reviewed' })
      try {
        unwrapResult(await markSelectedFeedbackReviewed({ ...scope, feedbackIds }))
        setSelected(new Set())
      } catch (error) {
        setError(globalThis.String(error))
      }
    })
  }
  const bulkConvertToIssue = function bulkConvertToIssue(selected: Set<string>): void {
    startTransition(async () => {
      const feedbackIds = [...selected]
      addOptimistic({ ids: feedbackIds, status: 'actioned' })
      try {
        unwrapResult(await convertSelectedFeedbackToIssue({ ...scope, feedbackIds }))
        setSelected(new Set())
      } catch (error) {
        setError(globalThis.String(error))
      }
    })
  }
  return fieldsInOrder([
    ['convert', convert],
    ['markReviewed', markReviewed],
    ['bulkMarkReviewed', bulkMarkReviewed],
    ['bulkConvertToIssue', bulkConvertToIssue],
  ])
}
