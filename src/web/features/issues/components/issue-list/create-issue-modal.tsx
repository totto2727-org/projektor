'use client'
import { Array } from 'effect'
import type { JSX, Dispatch, SetStateAction } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { Dialog } from '@/components/ui/dialog.tsx'
import Select from '@/components/ui/select.tsx'
import type { TaskStatus } from '@/features/issues/components/board-utils.ts'
import MarkdownEditor from '@/features/issues/components/lazy-markdown-editor.tsx'
import { PRIORITY_OPTIONS } from '@/features/issues/utils/issue-utils.ts'

import type { ProjectMeta } from './types.ts'

/*
 * PROJ-566: a caption *sibling*, never a wrapper. A <label> with no `for` binds to
 * its first labelable descendant — for a Select that's the trigger <button>, so the
 * menu's own <li> options (not interactive content) forwarded their clicks to it too.
 * Matches EpicList.tsx's create-epic form; the Select names itself via `ariaLabel`.
 */
const FIELD_CAPTION_CLASS = 'block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]'

interface CreateIssueModalProps {
  createTitle: string
  setCreateTitle: Dispatch<SetStateAction<string>>
  createBody: string
  setCreateBody: Dispatch<SetStateAction<string>>
  createPriority: string
  setCreatePriority: Dispatch<SetStateAction<string>>
  createProjectId: string
  setCreateProjectId: Dispatch<SetStateAction<string>>
  createTypeId: string
  setCreateTypeId: Dispatch<SetStateAction<string>>
  createStatusId: string
  setCreateStatusId: Dispatch<SetStateAction<string>>
  createError: string | null
  submittingCreate: boolean
  createValid: boolean
  workspaceSlug?: string
  submitCreate: (formData: FormData) => void
  setShowCreateModal: Dispatch<SetStateAction<boolean>>
  projects: ProjectMeta[]
  taskTypes: { id: string; key: string; name: string }[]
  statuses: TaskStatus[]
}

const CreateIssueModalFields = function CreateIssueModalFields({
  createPriority,
  setCreatePriority,
  createProjectId,
  setCreateProjectId,
  createTypeId,
  setCreateTypeId,
  createStatusId,
  setCreateStatusId,
  projects,
  taskTypes,
  statuses,
}: Omit<
  CreateIssueModalProps,
  | 'createTitle'
  | 'setCreateTitle'
  | 'createBody'
  | 'setCreateBody'
  | 'createError'
  | 'submittingCreate'
  | 'submitCreate'
  | 'createValid'
  | 'workspaceSlug'
  | 'setShowCreateModal'
>): JSX.Element {
  return (
    <div className='flex gap-3 mb-5 flex-wrap items-end'>
      {projects.length > 1 && (
        <div>
          {/* Select uses ariaLabel for accessibility */}
          <label className={FIELD_CAPTION_CLASS}>Project</label>
          <Select
            ariaLabel='Select project'
            value={createProjectId}
            onChange={setCreateProjectId}
            options={projects.map(({ id, name }) => ({ label: name, value: id }))}
          />
        </div>
      )}

      <div>
        {/* Select uses ariaLabel for accessibility */}
        <label className={FIELD_CAPTION_CLASS}>Priority</label>
        <Select
          ariaLabel='Select priority'
          value={createPriority}
          onChange={setCreatePriority}
          capitalize
          options={PRIORITY_OPTIONS}
          buttonStyle={{
            background: `var(--priority-${createPriority}-bg, var(--priority-low-bg))`,
            color: `var(--priority-${createPriority}-text, var(--text-muted))`,
            fontWeight: 500,
            borderColor: 'transparent',
          }}
        />
      </div>

      {Array.isArrayNonEmpty(taskTypes) && (
        <div>
          {/* Select uses ariaLabel for accessibility */}
          <label className={FIELD_CAPTION_CLASS}>Type</label>
          <Select
            ariaLabel='Select type'
            value={createTypeId}
            onChange={setCreateTypeId}
            options={[
              { label: 'No type', value: '' },
              ...taskTypes.map(({ id, name }) => ({ label: name, value: id })),
            ]}
          />
        </div>
      )}

      {Array.isArrayNonEmpty(statuses) && (
        <div>
          {/* Select uses ariaLabel for accessibility */}
          <label className={FIELD_CAPTION_CLASS}>Status</label>
          <Select
            ariaLabel='Select status'
            value={createStatusId}
            onChange={setCreateStatusId}
            options={[{ label: 'Default', value: '' }, ...statuses.map(({ id, name }) => ({ label: name, value: id }))]}
          />
        </div>
      )}
    </div>
  )
}

export default function CreateIssueModal(props: CreateIssueModalProps): JSX.Element {
  const {
    createTitle,
    setCreateTitle,
    createBody,
    setCreateBody,
    createError,
    submittingCreate,
    submitCreate,
    setShowCreateModal,
  } = props
  return (
    <Dialog
      open
      onClose={() => setShowCreateModal(false)}
      ariaLabel='Create new issue'
      className='flex flex-col gap-0 p-0 sm:max-w-[660px] overflow-hidden max-sm:h-[90dvh]'
    >
      <h2 className='shrink-0 px-6 pt-6 pb-4 text-lg font-bold text-text-base'>New issue</h2>

      <form action={submitCreate} className='flex flex-col flex-1 min-h-0'>
        {props.workspaceSlug && <input type='hidden' name='workspaceSlug' value={props.workspaceSlug} />}
        <input type='hidden' name='projectId' value={props.createProjectId} />
        <input type='hidden' name='priority' value={props.createPriority} />
        <input type='hidden' name='body' value={props.createBody} />
        {props.createTypeId && <input type='hidden' name='typeId' value={props.createTypeId} />}
        {props.createStatusId && <input type='hidden' name='statusId' value={props.createStatusId} />}
        <div className='flex-1 min-h-0 overflow-y-auto overscroll-contain px-6'>
          {createError && (
            <p role='alert' className='text-danger-text mb-3 text-sm'>
              {createError}
            </p>
          )}

          <div className='mb-[0.875rem]'>
            <label className='block text-[0.78rem] font-semibold text-text-muted uppercase tracking-[0.04em]'>
              Title *
              <input
                type='text'
                name='title'
                maxLength={500}
                value={createTitle}
                onInput={(event) => {
                  setCreateTitle((event.target as HTMLInputElement).value)
                }}
                placeholder='Issue title'
                required
                className={[
                  'w-full px-3 py-2 border border-border rounded bg-bg text-text-base box-border text-[0.9rem]',
                  'font-normal normal-case tracking-normal mt-[0.3rem]',
                ].join(' ')}
              />
            </label>
          </div>

          <div className='mb-[0.875rem]'>
            {/* PROJ-566: a caption sibling, NOT a wrapper. A <label> with no `for` forwards
							    clicks on its non-interactive descendants to its first labelable control —
							    here the editor toolbar's Bold button — so every tap in the editor body ran
							    Bold. The editor names itself via ariaLabel instead. */}
            {/* Caption for MarkdownEditor, which has no associable control */}
            <label className='block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]'>
              Description
            </label>
            <MarkdownEditor value={createBody} onChange={setCreateBody} minHeight='160px' ariaLabel='Description' />
          </div>

          <CreateIssueModalFields {...props} />
        </div>

        {/* Stays inside the <form> so the submit button still submits it. */}
        <div
          className={[
            'shrink-0 sticky bottom-0 flex gap-2 border-t border-border bg-bg px-6 pt-4',
            'pb-[max(1rem,env(safe-area-inset-bottom))]',
          ].join(' ')}
        >
          <Button type='submit' variant='primary' disabled={submittingCreate || !props.createValid}>
            {submittingCreate ? 'Creating…' : 'Create issue'}
          </Button>
          <Button type='button' variant='outline' onClick={() => setShowCreateModal(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
