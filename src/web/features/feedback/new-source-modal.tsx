'use client'

import { useForm, useStore } from '@tanstack/react-form'
import { String, Predicate, Schema } from 'effect'
import { useActionState, useEffect } from 'react'
import type { JSX } from 'react'

import { FormErrors } from '@/components/form-errors.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Dialog } from '@/components/ui/dialog.tsx'
import { Input, Textarea } from '@/components/ui/input.tsx'

import { createFeedbackSource } from './actions.ts'
import { SourceFields } from './schemas.ts'

interface Props {
  projectId: string
  workspaceSlug?: string
  onClose: () => void
  onCreated?: () => void
}

const NewSourceForm = function NewSourceForm({
  name,
  setName,
  description,
  setDescription,
  origins,
  setOrigins,
  creating,
  error,
  validationErrors,
  valid,
  action,
  projectId,
  workspaceSlug,
  onCancel,
}: {
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  origins: string
  setOrigins: (v: string) => void
  creating: boolean
  error: string | null
  validationErrors: unknown
  valid: boolean
  action: (data: FormData) => void
  projectId: string
  workspaceSlug?: string
  onCancel: () => void
}): JSX.Element {
  return (
    <form action={action}>
      <input type='hidden' name='projectId' value={projectId} />
      {workspaceSlug && <input type='hidden' name='workspaceSlug' value={workspaceSlug} />}
      <FormErrors errors={validationErrors} />
      {error && (
        <p role='alert' className='text-danger-text mb-3 text-sm'>
          {error}
        </p>
      )}
      <div className='mb-[0.875rem]'>
        <label
          className='block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]'
          htmlFor='fs-name'
        >
          Name *
        </label>
        <Input
          id='fs-name'
          name='name'
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={100}
        />
      </div>
      <div className='mb-[0.875rem]'>
        <label
          className='block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]'
          htmlFor='fs-desc'
        >
          Description
        </label>
        <Input
          id='fs-desc'
          name='description'
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
        />
      </div>
      <div className='mb-[0.875rem]'>
        <label
          className='block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]'
          htmlFor='fs-origins'
        >
          Allowed origins (one per line, optional)
        </label>
        <Textarea
          id='fs-origins'
          name='origins'
          rows={2}
          value={origins}
          onChange={(event) => setOrigins(event.target.value)}
        />
      </div>
      <div className='flex gap-2'>
        <Button type='submit' variant='primary' size='sm' disabled={creating || !valid}>
          {creating ? 'Creating…' : 'Create source'}
        </Button>
        <Button type='button' variant='outline' size='sm' onClick={onCancel} disabled={creating}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export default function NewSourceModal({ projectId, workspaceSlug, onClose, onCreated }: Props): JSX.Element {
  const [result, action, creating] = useActionState(createFeedbackSource, null)
  const newToken = result?.ok === true ? result.value.token : null
  const error = result && !result.ok ? result.message : null
  const form = useForm({
    defaultValues: { name: '', description: '', origins: '' },
    validators: {
      onMount: Schema.toStandardSchemaV1(SourceFields),
      onChange: Schema.toStandardSchemaV1(SourceFields),
    },
  })
  const { name, description, origins } = useStore(form.store, (state) => state.values)
  const valid = useStore(form.store, (state) => state.isValid)
  const validationErrors = useStore(form.store, (state) => [
    state.fieldMeta.name?.errors,
    state.fieldMeta.description?.errors,
    state.fieldMeta.origins?.errors,
  ])
  const setName = (value: string): void => form.setFieldValue('name', value)
  const setDescription = (value: string): void => form.setFieldValue('description', value)
  const setOrigins = (value: string): void => form.setFieldValue('origins', value)
  useEffect(() => {
    if (Predicate.isNotNullish(newToken) && String.isNonEmpty(newToken)) {
      onCreated?.()
    }
  }, [newToken, onCreated])

  return (
    <Dialog
      open={true}
      onClose={() => {
        if (Predicate.isNullish(newToken) || String.isEmpty(newToken)) {
          onClose()
        }
      }}
      ariaLabel='New feedback source'
    >
      <h2 className='mb-5 text-lg font-bold text-text-base'>New feedback source</h2>

      {Predicate.isNotNullish(newToken) && String.isNonEmpty(newToken) ? (
        <div className='bg-surface border border-border rounded-md p-4'>
          <p className='text-danger-text text-[0.8rem] my-1'>
            ⚠ Copy this token now — you won't be able to see it again.
          </p>
          <code className='block font-mono text-[0.8rem] px-2 py-[0.375rem] bg-bg border border-border rounded break-all'>
            {newToken}
          </code>
          <Button type='button' variant='primary' size='sm' className='mt-3' onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <NewSourceForm
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          origins={origins}
          setOrigins={setOrigins}
          creating={creating}
          error={error}
          validationErrors={validationErrors}
          valid={valid}
          action={action}
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          onCancel={onClose}
        />
      )}
    </Dialog>
  )
}
