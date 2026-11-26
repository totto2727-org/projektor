'use client'

import { Predicate, String } from 'effect'
import type { JSX } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { formatBytes } from '@/lib/file-size.ts'

export interface Attachment {
  id: string
  filename: string
  contentType: string
  size: number
  createdAt: number
}

const REFERENCED_BADGE_CLASS =
  'inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold ' +
  'uppercase tracking-wide shrink-0'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function AttachmentEntry({
  attachment,
  workspaceSlug,
  referenced,
  onDelete,
  isPublicViewer,
}: {
  attachment: Attachment
  workspaceSlug?: string
  referenced: boolean
  onDelete: (attachmentId: string) => void
  isPublicViewer: boolean
}): JSX.Element {
  const qs =
    Predicate.isNotNullish(workspaceSlug) && String.isNonEmpty(workspaceSlug) ? `?workspace=${workspaceSlug}` : ''
  return (
    <div className='flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-surface'>
      <a
        href={`/api/files/${attachment.id}${qs}`}
        target='_blank'
        rel='noreferrer'
        className='text-accent text-sm no-underline hover:underline flex-1 min-w-0 truncate'
      >
        {attachment.filename}
      </a>
      <span
        className={REFERENCED_BADGE_CLASS}
        style={
          referenced
            ? { background: 'var(--status-done-bg)', color: 'var(--status-done)' }
            : { background: 'var(--priority-low-bg)', color: 'var(--priority-low-text)' }
        }
      >
        {referenced ? 'In page' : 'Unreferenced'}
      </span>
      <span className='text-xs text-text-muted shrink-0'>{formatBytes(attachment.size)}</span>
      {!isPublicViewer && (
        <Button
          size='sm'
          onClick={() => {
            onDelete(attachment.id)
          }}
          aria-label={`Delete ${attachment.filename}`}
          className='bg-transparent border-none text-text-muted px-[0.125rem] leading-none'
        >
          ×
        </Button>
      )}
    </div>
  )
}
