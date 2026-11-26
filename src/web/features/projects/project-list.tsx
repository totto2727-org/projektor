'use client'

import { useForm } from '@tanstack/react-form'
import { Array, Schema, Predicate } from 'effect'
import { useActionState, useEffect, useRef } from 'react'
import type { JSX } from 'react'

import { hasMultipleItems, hasSingleItem } from '#contracts/item-count.ts'
import { useRuntime } from '@/client/runtime.tsx'
import { FormErrors } from '@/components/form-errors.tsx'
import { Input } from '@/components/generated/input.tsx'
import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'

import { createProject } from './actions.ts'
import { ProjectTile } from './project-tile.tsx'
import { CreateProjectInputSchema } from './schemas.ts'
import type { ProjectSummary } from './schemas.ts'

interface Membership {
  id: string
  name: string
  slug: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}
const deriveKey = (name: string): string =>
  name
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/gu, '')
    .slice(0, 10)

interface ProjectCreationField {
  handleBlur: () => void
  handleChange: (value: string) => void
  state: { value: string }
}

const renderProjectKeyInput = (field: ProjectCreationField): JSX.Element => (
  <label className='grid min-w-0 gap-1'>
    Key
    <Input
      name='key'
      required
      maxLength={10}
      placeholder='MYPROJ'
      value={field.state.value}
      onBlur={field.handleBlur}
      onChange={(event) => field.handleChange(event.currentTarget.value.toUpperCase())}
    />
  </label>
)
const renderProjectDescriptionInput = (field: ProjectCreationField): JSX.Element => (
  <label className='grid min-w-0 gap-1'>
    Description
    <Input
      name='description'
      maxLength={500}
      placeholder='Optional description'
      value={field.state.value}
      onBlur={field.handleBlur}
      onChange={(event) => field.handleChange(event.currentTarget.value)}
    />
  </label>
)

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const ProjectList = function ProjectList({
  initialProjects,
  memberships,
  showArchived = false,
}: {
  initialProjects: Readonly<ProjectSummary[]>
  memberships: Readonly<Membership[]>
  showArchived?: boolean
}): JSX.Element {
  const runtime = useRuntime()
  const url = new URL(runtime.url)
  const disclosure = useRef<HTMLDetailsElement>(null)
  const [result, formAction, pending] = useActionState(createProject, null)
  const isPublicViewer = runtime.scope?.user.email === 'public-viewer@projektor.local'
  const selectedWorkspace = runtime.scope?.selection.kind === 'workspace' ? runtime.scope.selection.workspace : null
  const accessPending =
    Predicate.isNotNullish(selectedWorkspace) &&
    (selectedWorkspace.role === 'member' || selectedWorkspace.role === 'viewer') &&
    !initialProjects.some((project) => project.workspace_slug === selectedWorkspace.slug)
  const writable = isPublicViewer
    ? []
    : memberships.filter(
        (item) =>
          (item.role === 'owner' || item.role === 'admin') &&
          (!selectedWorkspace || item.slug === selectedWorkspace.slug),
      )
  const form = useForm({
    defaultValues: {
      workspaceSlug: hasSingleItem(writable) ? writable[0].slug : '',
      name: '',
      key: '',
      description: '',
    },
    validators: {
      onChange: Schema.toStandardSchemaV1(CreateProjectInputSchema),
      onSubmit: Schema.toStandardSchemaV1(CreateProjectInputSchema),
    },
  })
  useEffect(() => {
    if (result?.ok === true && disclosure.current) {
      disclosure.current.open = false
    }
  }, [result])
  if (accessPending) {
    return (
      <div role='status' className='flex flex-col items-center gap-3 text-center max-w-md mx-auto py-16 px-6'>
        <div
          aria-hidden='true'
          className='flex items-center justify-center w-12 h-12 rounded-full bg-surface border border-border text-2xl'
        >
          🔒
        </div>
        <h2 className='m-0 text-lg font-semibold text-text-base'>Access pending</h2>
        <p className='m-0 text-sm text-text-muted'>
          You’re not a member of any project group yet. Once a workspace admin adds you to a group, the projects,
          issues, and wiki pages you can access will appear here.
        </p>
      </div>
    )
  }
  const renderArchiveOption = (): JSX.Element => (
    <label className='flex items-center gap-1.5 text-xs text-text-muted'>
      <input
        type='checkbox'
        name='includeArchived'
        value='true'
        defaultChecked={showArchived}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      />
      Show archived
    </label>
  )
  const renderArchivedCatalogFilter = (): JSX.Element => (
    <form method='get' action={url.pathname} className='flex items-center gap-2'>
      {[...url.searchParams]
        .filter(([name]) => name !== 'includeArchived')
        .map(([name, value]) => (
          <input key={`${name}:${value}`} type='hidden' name={name} value={value} />
        ))}
      {renderArchiveOption()}
      <Button type='submit' variant='outline' size='sm'>
        Apply
      </Button>
    </form>
  )
  const renderWorkspaceChoice = (field: ProjectCreationField): JSX.Element =>
    hasMultipleItems(writable) ? (
      <select
        // Native selects otherwise size to their longest option, overflowing narrow forms.
        className='w-full min-w-0'
        name='workspaceSlug'
        required
        aria-label='Workspace'
        value={field.state.value}
        onChange={(event) => {
          field.handleChange(event.currentTarget.value)
        }}
        onBlur={field.handleBlur}
        disabled={pending}
      >
        <option value=''>Choose a workspace</option>
        {writable.map((item) => (
          <option key={item.id} value={item.slug}>
            {item.name} ({item.slug})
          </option>
        ))}
      </select>
    ) : (
      <>
        <input type='hidden' name='workspaceSlug' value={field.state.value} />
        <p className='m-0 text-sm text-text-muted'>
          {writable[0].name} ({writable[0].slug})
        </p>
      </>
    )
  const renderProjectNameInput = (field: ProjectCreationField): JSX.Element => (
    <label className='grid min-w-0 gap-1'>
      Name
      <Input
        name='name'
        required
        maxLength={100}
        placeholder='My Project'
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => {
          const { value } = event.currentTarget
          field.handleChange(value)
          if (form.getFieldMeta('key')?.isTouched !== true) {
            form.setFieldValue('key', deriveKey(value))
          }
        }}
      />
    </label>
  )
  const renderWorkspaceField = (): JSX.Element => (
    <div>
      <p className='m-0 mb-1 text-xs font-semibold text-text-muted'>Workspace</p>
      <form.Field name='workspaceSlug'>{renderWorkspaceChoice}</form.Field>
    </div>
  )
  const renderProjectFields = (): JSX.Element => (
    <div className='grid gap-3 sm:grid-cols-[2fr_1fr_3fr]'>
      <form.Field name='name'>{renderProjectNameInput}</form.Field>
      <form.Field name='key'>{renderProjectKeyInput}</form.Field>
      <form.Field name='description'>{renderProjectDescriptionInput}</form.Field>
    </div>
  )
  const renderCreateProjectActions = (canSubmit: boolean): JSX.Element => (
    <div className='flex gap-2 justify-end'>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => {
          if (disclosure.current) {
            disclosure.current.open = false
          }
        }}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button type='submit' variant='primary' size='sm' disabled={pending || !canSubmit}>
        {pending ? 'Creating…' : 'Create project'}
      </Button>
    </div>
  )
  const renderCreateProjectForm = (): JSX.Element => (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!form.state.canSubmit) {
          event.preventDefault()
        }
      }}
      className='bg-surface border border-border rounded-lg p-4 mt-3 flex flex-col gap-3'
    >
      {renderWorkspaceField()}
      {renderProjectFields()}
      <FormErrors errors={form.state.errors} className='m-0 text-red-600' />
      {result && !result.ok && (
        <p role='alert' className='m-0 text-xs text-red-600'>
          {result.message}
        </p>
      )}
      <form.Subscribe<boolean> selector={(state) => state.canSubmit}>{renderCreateProjectActions}</form.Subscribe>
    </form>
  )
  return (
    <>
      <h1 className='mb-6 text-2xl font-semibold'>Projects</h1>
      <div className='flex justify-between items-center mb-4'>
        {renderArchivedCatalogFilter()}
        {isPublicViewer ? (
          <p className='text-xs text-text-muted m-0'>Read-only demo — projects can't be created here.</p>
        ) : (
          Array.isArrayEmpty(writable) && (
            <p className='text-xs text-text-muted m-0'>You need an owner or admin workspace role to create projects.</p>
          )
        )}
      </div>
      {Array.isArrayNonEmpty(writable) && (
        <details ref={disclosure} className='mb-5'>
          <summary className='btn btn-primary text-xs w-fit ml-auto cursor-pointer'>+ New project</summary>
          {renderCreateProjectForm()}
        </details>
      )}
      {Array.isReadonlyArrayEmpty(initialProjects) ? (
        <EmptyState title='No projects yet.' />
      ) : (
        <div className='grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]'>
          {initialProjects.map((project) => (
            <ProjectTile key={project.id} project={project} />
          ))}
        </div>
      )}
    </>
  )
}
