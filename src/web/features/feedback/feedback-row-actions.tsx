import type { JSX } from 'react'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { Button } from '@/components/ui/button.tsx'

import type { Feedback } from './feedback-list.tsx'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FeedbackRowActions = function FeedbackRowActions({
  row,
  onMarkReviewed,
  onConvert,
}: {
  row: Feedback
  onMarkReviewed: (id: string) => void
  onConvert: (id: string) => void
}): JSX.Element {
  return (
    <div className='flex gap-2 flex-wrap'>
      {row.status === 'new' && (
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            onMarkReviewed(row.id)
          }}
        >
          Mark reviewed
        </Button>
      )}
      {isNonEmptyText(row.linkedIssueId) ? (
        <span className='text-[0.8rem] text-text-muted'>Linked</span>
      ) : (
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            onConvert(row.id)
          }}
        >
          Convert to issue
        </Button>
      )}
    </div>
  )
}
