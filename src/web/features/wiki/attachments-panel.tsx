'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { AttachmentEntry } from './attachment-entry.tsx'
import type { Attachment } from './attachment-entry.tsx'
import { AttachmentUploadForm } from './attachment-upload-form.tsx'
import { usePublicViewer } from './wiki-seed-context.ts'

/*
 * PROJ-494: whether an attachment's id appears anywhere in the page's current markdown
 * (e.g. as part of an inline `![alt](/api/files/:id...)` ref). A plain substring check —
 * good enough to tell "referenced" from "orphaned" without parsing markdown image syntax,
 * and it also catches an id pasted into a manual link or wiki_ref-style reference.
 */
const isReferenced = function isReferenced(attachmentId: string, content: string): boolean {
  return content.includes(attachmentId)
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function AttachmentsPanel({
  attachments,
  workspaceSlug,
  content,
  uploadFormOpen,
  uploadError,
  onToggleUploadForm,
  onCancelUpload,
  onDeleteAttachment,
}: {
  attachments: Attachment[]
  workspaceSlug?: string
  content: string
  uploadFormOpen: boolean
  uploadError: string | undefined
  onToggleUploadForm: (open: boolean) => void
  onCancelUpload: () => void
  onDeleteAttachment: (attachmentId: string) => void
}): JSX.Element {
  const isPublicViewer = usePublicViewer(workspaceSlug)
  return (
    <div className='mt-8'>
      <h3 className='text-xs uppercase tracking-[0.05em] text-text-muted font-semibold mb-3 pb-2 border-b border-border'>
        {`Attachments${Array.isArrayNonEmpty(attachments) ? ` (${attachments.length})` : ''}`}
      </h3>

      {Array.isArrayNonEmpty(attachments) && (
        <div className='mb-4 flex flex-col gap-2'>
          {attachments.map((attachment) => (
            <AttachmentEntry
              key={attachment.id}
              attachment={attachment}
              workspaceSlug={workspaceSlug}
              referenced={isReferenced(attachment.id, content)}
              onDelete={onDeleteAttachment}
              isPublicViewer={isPublicViewer}
            />
          ))}
        </div>
      )}

      {!isPublicViewer &&
        (uploadFormOpen ? (
          <AttachmentUploadForm uploadError={uploadError} onCancel={onCancelUpload} />
        ) : (
          <button
            type='button'
            onClick={() => {
              onToggleUploadForm(true)
            }}
            className='text-sm text-text-muted hover:text-text-base transition-colors flex items-center gap-1'
          >
            <span className='text-base leading-none'>+</span>
            <span>Attach file</span>
          </button>
        ))}
    </div>
  )
}
