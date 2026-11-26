'use client'

import { useForm, useStore } from '@tanstack/react-form'
import { Schema } from 'effect'
import { useRef } from 'react'
import type { JSX } from 'react'

import { AttachmentUpload } from '@/components/attachment-upload.tsx'
import { FormErrors } from '@/components/form-errors.tsx'
import { Button } from '@/components/ui/button.tsx'

import { AttachmentFields } from './form-schemas.ts'
import { useWikiSeed } from './wiki-seed-context.ts'

const renderWikiAttachmentPicker = (
  form: { setFieldValue: (name: 'file', value: File | null) => void },
  uploadFile: File | null,
): JSX.Element => (
  <label className='relative cursor-pointer'>
    <input
      type='file'
      name='file'
      required
      className='sr-only'
      onChange={(event) => {
        form.setFieldValue('file', event.currentTarget.files?.[0] ?? null)
      }}
    />
    <Button as='span' variant='outline' size='sm'>
      {uploadFile ? uploadFile.name : 'Choose file'}
    </Button>
  </label>
)

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function AttachmentUploadForm({
  uploadError,
  onCancel,
}: {
  uploadError: string | undefined
  onCancel: () => void
}): undefined | JSX.Element {
  const seed = useWikiSeed()
  const form = useForm({
    defaultValues: { file: null as File | null },
    validators: {
      onMount: Schema.toStandardSchemaV1(AttachmentFields),
      onChange: Schema.toStandardSchemaV1(AttachmentFields),
    },
  })
  const uploadFile = useStore(form.store, (state) => state.values.file)
  const valid = useStore(form.store, (state) => state.isValid)
  const errors = useStore(form.store, (state) => state.fieldMeta.file?.errors ?? [])
  const validatedSubmit = useRef(false)
  const submit = async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    if (validatedSubmit.current) {
      validatedSubmit.current = false
      return
    }
    event.preventDefault()
    const nativeForm = event.currentTarget
    await form.validate('change')
    if (!form.state.isValid) {
      return
    }
    validatedSubmit.current = true
    nativeForm.requestSubmit()
  }
  if (!seed.page) {
    return undefined
  }
  return (
    <AttachmentUpload
      workspaceSlug={seed.workspaceSlug}
      entityType='wiki_page'
      entityId={seed.page.id}
      onSubmit={submit}
    >
      <div className='flex flex-wrap gap-2 items-center'>
        {renderWikiAttachmentPicker(form, uploadFile)}
        <Button type='submit' variant='primary' disabled={!valid}>
          Upload
        </Button>
        <Button type='button' variant='outline' onClick={onCancel}>
          Cancel
        </Button>
        {uploadError && (
          <span role='alert' className='text-[0.8rem] text-danger-text self-center'>
            {uploadError}
          </span>
        )}
        {uploadFile && <FormErrors errors={errors} />}
      </div>
    </AttachmentUpload>
  )
}
