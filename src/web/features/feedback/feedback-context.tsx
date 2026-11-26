import { Predicate, String } from 'effect'
import type { JSX } from 'react'

import type { Feedback } from './feedback-list.tsx'

const parseContext = function parseContext(
  sourceUrl: string | null,
): { params: [string, string][]; url: string } | undefined {
  if (Predicate.isNullish(sourceUrl) || String.isEmpty(sourceUrl)) {
    return undefined
  }
  try {
    const parsed = new URL(sourceUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined
    }
    return { params: globalThis.Array.from(parsed.searchParams.entries()), url: sourceUrl }
  } catch {
    return undefined
  }
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FeedbackContext = function FeedbackContext({
  row,
  expanded,
  onToggle,
}: {
  row: Feedback
  expanded: boolean
  onToggle: () => void
}): undefined | JSX.Element {
  const context = parseContext(row.sourceUrl)
  if (!context) {
    return undefined
  }
  return (
    <div className='mt-1'>
      <button type='button' className='text-[0.75rem] text-text-muted underline' onClick={onToggle}>
        Context ({context.params.length})
      </button>
      {expanded && (
        <div className='text-[0.75rem] text-text-muted mt-1 flex flex-col gap-0.5'>
          <a href={context.url} target='_blank' rel='noopener noreferrer' className='underline'>
            {context.url}
          </a>
          {context.params.map(([key, value]) => (
            <div key={key}>
              {key}: {value}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
