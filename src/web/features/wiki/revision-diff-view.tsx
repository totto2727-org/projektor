'use client'

import { Number, String } from 'effect'
import type { JSX } from 'react'

const FIRST_OCCURRENCE_INDEX = 0

const diffLineClass = function diffLineClass(line: string): string {
  if (line.startsWith('+')) {
    return 'text-green-600'
  }
  if (line.startsWith('-')) {
    return 'text-red-600'
  }
  return 'text-text-muted'
}

/*
 * PROJ-492 (R10): renders the server's unified diff text (--- base / +++ current, @@
 * hunks, +/- lines) with per-line coloring. An empty diff means the two sides are
 * identical (services/wiki.ts#buildUnifiedDiff returns "" in that case).
 */
// oxlint-disable-next-line eslint/func-style -- react/function-component-definition requires a function declaration.
export function RevisionDiffView({ diff }: { diff: string }): JSX.Element {
  if (String.isEmpty(diff)) {
    return <p className='mt-2 mb-1 text-[0.75rem] text-text-muted italic'>No changes.</p>
  }
  const occurrences = new Map<string, number>()
  return (
    <pre
      className={
        'mt-2 mb-1 p-2 bg-surface border border-border rounded-md text-[0.75rem] ' +
        'overflow-x-auto leading-snug whitespace-pre-wrap'
      }
    >
      {diff.split('\n').map((line) => {
        const occurrence = occurrences.get(line) ?? FIRST_OCCURRENCE_INDEX
        occurrences.set(line, Number.increment(occurrence))
        const cls = diffLineClass(line)
        return (
          <div key={`${line}:${occurrence}`} className={cls}>
            {String.isNonEmpty(line) ? line : ' '}
          </div>
        )
      })}
    </pre>
  )
}
