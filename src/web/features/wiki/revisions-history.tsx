'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { Button } from '@/components/ui/button.tsx'

import { RevisionRow } from './revision-row.tsx'
import type { WikiRevision } from './revision-row.tsx'

export type { WikiRevision } from './revision-row.tsx'

// oxlint-disable-next-line eslint/func-style -- react/function-component-definition requires a function declaration.
export function RevisionsHistory({
  revisions,
  showHistory,
  onToggle,
  workspaceSlug,
  pageSlug,
  onRestore,
  restoringId,
  editing,
}: {
  revisions: WikiRevision[]
  showHistory: boolean
  onToggle: () => void
  workspaceSlug: string | undefined
  pageSlug: string
  onRestore: (revision: WikiRevision) => void
  restoringId: string | undefined
  editing: boolean
}): undefined | JSX.Element {
  if (Array.isArrayEmpty(revisions)) {
    return undefined
  }
  return (
    <div className='mt-8'>
      <Button variant='outline' size='sm' onClick={onToggle} className='text-text-muted'>
        {showHistory ? '▲ Hide history' : '▼ History'} ({revisions.length})
      </Button>
      {showHistory && (
        <ul className='mt-3 list-none p-0'>
          {revisions.map((revision) => (
            <RevisionRow
              key={revision.id}
              revision={revision}
              workspaceSlug={workspaceSlug}
              pageSlug={pageSlug}
              onRestore={onRestore}
              restoring={restoringId === revision.id}
              editing={editing}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
