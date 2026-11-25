'use client'

import { query } from '@effront/core/query'
import { Effect, Predicate, String } from 'effect'
import { useState } from 'react'
import type { JSX } from 'react'

import { unwrapResult } from '@/client/functions.ts'
import { Button } from '@/components/ui/button.tsx'
import { formatTimestamp } from '@/features/timestamp.ts'

import { getWikiRevisionDiff } from './actions.ts'
import { RevisionDiffView } from './revision-diff-view.tsx'

export interface WikiRevision {
  id: string
  author_id: string | null
  author_name: string | null
  created_at: number
  summary: string | null
}

/*
 * PROJ-808: restoring while the page is being edited raced the edit's own save against
 * the restore's PUT — both build their request off the revision the user started from,
 * so whichever lands second gets a 409 against a revision it created itself. Simplest
 * correct fix: disable Restore during editing rather than trying to reconcile the two.
 */
const RESTORE_DISABLED_WHILE_EDITING_REASON = 'Finish or cancel editing before restoring a previous revision'

// oxlint-disable-next-line eslint/func-style -- react/function-component-definition requires a function declaration.
export function RevisionRow({
  revision,
  workspaceSlug,
  pageSlug,
  onRestore,
  restoring,
  editing,
}: {
  revision: WikiRevision
  workspaceSlug: string | undefined
  pageSlug: string
  onRestore: (revision: WikiRevision) => void
  restoring: boolean
  editing: boolean
}): JSX.Element {
  const [diffOpen, setDiffOpen] = useState(false)
  const [diff, setDiff] = useState<string>()
  const [diffError, setDiffError] = useState<string>()
  const [diffLoading, setDiffLoading] = useState(false)

  const toggleDiff = async function toggleDiff(): Promise<void> {
    if (diffOpen) {
      setDiffOpen(false)
      return
    }
    setDiffOpen(true)
    if (Predicate.isNotNullish(diff) || diffLoading) {
      return
    }
    setDiffLoading(true)
    setDiffError(undefined)
    try {
      const result = unwrapResult(
        await Effect.runPromise(query(getWikiRevisionDiff)({ workspaceSlug, slug: pageSlug, revisionId: revision.id })),
      )
      setDiff(result.diff)
    } catch (caughtError) {
      setDiffError(globalThis.String(caughtError))
    }
    setDiffLoading(false)
  }

  return (
    <li className='py-[0.375rem] border-b border-border text-[0.8rem] text-text-muted'>
      <div className='flex items-center flex-wrap gap-2'>
        <span>
          <strong className='text-text-base'>{revision.author_name ?? 'Unknown'}</strong>
          {' — '}
          {formatTimestamp(revision.created_at)}
        </span>
        <Button variant='outline' size='sm' onClick={toggleDiff} className='text-text-muted py-0 px-2'>
          {diffOpen ? 'Hide diff' : 'Diff vs current'}
        </Button>
        <Button
          variant='outline'
          size='sm'
          onClick={() => {
            onRestore(revision)
          }}
          disabled={restoring || editing}
          title={editing ? RESTORE_DISABLED_WHILE_EDITING_REASON : undefined}
          className='text-text-muted py-0 px-2'
        >
          {restoring ? 'Restoring…' : 'Restore'}
        </Button>
      </div>
      {revision.summary && <p className='mt-1 mb-0 italic'>{revision.summary}</p>}
      {diffOpen &&
        (diffLoading ? (
          <p className='mt-2 mb-1 text-[0.75rem]'>Loading diff…</p>
        ) : Predicate.isNotNullish(diffError) && String.isNonEmpty(diffError) ? (
          <p role='alert' className='mt-2 mb-1 text-[0.75rem] text-danger-text'>
            {diffError}
          </p>
        ) : (
          <RevisionDiffView diff={diff ?? ''} />
        ))}
    </li>
  )
}
