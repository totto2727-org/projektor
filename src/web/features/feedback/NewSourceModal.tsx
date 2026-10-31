'use client'

import { useForm, useStore } from '@tanstack/react-form'
import { Schema } from 'effect'
import { useActionState, useEffect } from 'react'

import { FormErrors } from '../../components/FormErrors'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input, Textarea } from '../../components/ui/Input'
import { createFeedbackSource } from './actions'
import { SourceFields } from './schemas'

interface Props {
  projectId: string
  workspaceSlug?: string
  onClose: () => void
  onCreated?: () => void
}

function NewSourceForm({
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
}) {
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
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
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
          onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
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
          onChange={(e) => setOrigins((e.target as HTMLTextAreaElement).value)}
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

export default function NewSourceModal({ projectId, workspaceSlug, onClose, onCreated }: Props) {
  const [result, action, creating] = useActionState(createFeedbackSource, null)
  const newToken = result?.ok ? result.value.token : null
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
  const setName = (value: string) => form.setFieldValue('name', value)
  const setDescription = (value: string) => form.setFieldValue('description', value)
  const setOrigins = (value: string) => form.setFieldValue('origins', value)
  useEffect(() => {
    if (newToken) onCreated?.()
  }, [newToken, onCreated])

  return (
    <Dialog
      open={true}
      onClose={() => {
        if (!newToken) onClose()
      }}
      ariaLabel='New feedback source'
    >
      <h2 className='mb-5 text-lg font-bold text-text-base'>New feedback source</h2>

      {newToken ? (
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
