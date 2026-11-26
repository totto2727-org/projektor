'use client'

import { useForm } from '@tanstack/react-form'
import { Array, Schema } from 'effect'
import { useActionState, useEffect, useState } from 'react'
import type { JSX } from 'react'

import { unwrapResult } from '@/client/functions.ts'
import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { Input, Textarea } from '@/components/ui/input.tsx'
import { FormErrors } from '@/features/planning/form-ui.tsx'

import {
  addGroupMember,
  createGroup,
  createGroupGrant,
  deleteGroup,
  describeGroup,
  removeGroupGrant,
  removeGroupMember,
  renameGroup,
} from './actions.ts'
import { renderGroupGrantRows, renderGroupMemberRows } from './group-editor-rows.tsx'
import { GroupsList } from './group-list.tsx'
import { MembersOverview } from './group-members-overview.tsx'
import { adminRole, ROLES } from './group-roles.ts'
import { GroupSettingsTabs } from './group-settings-tabs.tsx'
import { CARD, H2, INPUT } from './group-styles.ts'
import {
  CreateGroupInputSchema,
  GroupDescriptionInputSchema,
  GroupGrantInputSchema,
  GroupMemberInputSchema,
  RenameGroupInputSchema,
} from './input-schemas.ts'
import type { GroupView } from './input-schemas.ts'
import type { GroupData, GroupDetail, ProjectLite, WorkspaceMember } from './types.ts'

const INFO =
  'flex items-center gap-2 border border-border rounded-lg bg-bg px-4 py-3 mb-4 text-[0.82rem] text-text-base'
const ROLE_TAG =
  'inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold bg-accent text-white uppercase tracking-wide'
/** Details, membership and grant rows are prop-owned, while unsaved editor fields are local. */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const GroupDetailEditor = function GroupDetailEditor({
  slug,
  detail,
  members,
  projects,
  onClose,
}: {
  slug: string
  detail: GroupDetail
  members: WorkspaceMember[]
  projects: ProjectLite[]
  onClose: () => void
}): JSX.Element {
  const [operationBusy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameResult, nameAction, namePending] = useActionState(renameGroup, null)
  const [descriptionResult, descriptionAction, descriptionPending] = useActionState(describeGroup, null)
  const [memberResult, memberAction, memberPending] = useActionState(addGroupMember, null)
  const [grantResult, grantAction, grantPending] = useActionState(createGroupGrant, null)
  const busy = operationBusy || namePending || descriptionPending || memberPending || grantPending
  const [defaults] = useState(() => ({
    name: { workspaceSlug: slug, groupId: detail.id, name: detail.name },
    description: { workspaceSlug: slug, groupId: detail.id, description: detail.description ?? '' },
    member: { workspaceSlug: slug, groupId: detail.id, userId: '' },
    grant: { workspaceSlug: slug, groupId: detail.id, projectId: '', role: 'member' },
  }))
  const nameValidator = Schema.toStandardSchemaV1(RenameGroupInputSchema)
  const descriptionValidator = Schema.toStandardSchemaV1(GroupDescriptionInputSchema)
  const memberValidator = Schema.toStandardSchemaV1(GroupMemberInputSchema)
  const grantValidator = Schema.toStandardSchemaV1(GroupGrantInputSchema)
  const nameForm = useForm({
    defaultValues: defaults.name,
    validators: { onMount: nameValidator, onChange: nameValidator, onSubmit: nameValidator },
  })
  const descriptionForm = useForm({
    defaultValues: defaults.description,
    validators: {
      onMount: descriptionValidator,
      onChange: descriptionValidator,
      onSubmit: descriptionValidator,
    },
  })
  const memberForm = useForm({
    defaultValues: defaults.member,
    validators: { onMount: memberValidator, onChange: memberValidator, onSubmit: memberValidator },
  })
  const grantForm = useForm({
    defaultValues: defaults.grant,
    validators: { onMount: grantValidator, onChange: grantValidator, onSubmit: grantValidator },
  })
  useEffect(() => {
    if (memberResult?.ok === true) {
      memberForm.reset()
    }
  }, [memberResult, memberForm])
  useEffect(() => {
    if (grantResult?.ok === true) {
      grantForm.reset()
    }
  }, [grantResult, grantForm])
  const addable = members.filter(
    (member) => !adminRole(member.role) && !detail.members.some((row) => row.userId === member.id),
  )
  const grantable = projects.filter((project) => !detail.grants.some((row) => row.projectId === project.id))
  const removeMember = async function removeMember(userId: string): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      unwrapResult(await removeGroupMember({ workspaceSlug: slug, groupId: detail.id, userId }))
    } catch (currentError) {
      setBusy(false)
      setError(String(currentError))
      return
    }
    setBusy(false)
  }
  const removeGrant = async function removeGrant(projectId: string): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      unwrapResult(await removeGroupGrant({ workspaceSlug: slug, groupId: detail.id, projectId }))
    } catch (currentError) {
      setBusy(false)
      setError(String(currentError))
      return
    }
    setBusy(false)
  }
  return (
    <section className={CARD}>
      <form className='flex flex-wrap items-center gap-2 mb-4' action={nameAction}>
        <input type='hidden' name='workspaceSlug' value={slug} />
        <input type='hidden' name='groupId' value={detail.id} />
        <label className='sr-only' htmlFor={`group-name-${detail.id}`}>
          Group name
        </label>
        <nameForm.Field name='name'>
          {(field) => (
            <Input
              id={`group-name-${detail.id}`}
              name='name'
              className='max-w-[22rem]'
              value={field.state.value}
              maxLength={100}
              disabled={busy}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.currentTarget.value)
              }}
            />
          )}
        </nameForm.Field>
        <nameForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            dirty: state.isDirty,
            errors: state.errors,
          })}
        >
          {({ canSubmit, dirty, errors }) => (
            <>
              <Button type='submit' variant='primary' disabled={busy || !canSubmit || !dirty}>
                Rename
              </Button>
              {dirty && <FormErrors errors={errors} />}
            </>
          )}
        </nameForm.Subscribe>
        {nameResult?.ok === false && (
          <p role='alert' className='text-danger-text text-xs'>
            {nameResult.message}
          </p>
        )}
        <Button variant='outline' disabled={busy} onClick={onClose}>
          Close
        </Button>
      </form>
      <form className='mb-4' action={descriptionAction}>
        <input type='hidden' name='workspaceSlug' value={slug} />
        <input type='hidden' name='groupId' value={detail.id} />
        <label className='text-[0.8rem] font-semibold text-text-muted' htmlFor={`group-description-${detail.id}`}>
          Description
        </label>
        <descriptionForm.Field name='description'>
          {(field) => (
            <Textarea
              id={`group-description-${detail.id}`}
              name='description'
              value={field.state.value}
              maxLength={500}
              disabled={busy}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.currentTarget.value)
              }}
            />
          )}
        </descriptionForm.Field>
        <descriptionForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            dirty: state.isDirty,
            errors: state.errors,
          })}
        >
          {({ canSubmit, dirty, errors }) => (
            <>
              <Button
                type='submit'
                variant='outline'
                size='sm'
                className='mt-2'
                disabled={busy || !canSubmit || !dirty}
              >
                Save description
              </Button>
              {dirty && <FormErrors errors={errors} />}
            </>
          )}
        </descriptionForm.Subscribe>
        {descriptionResult?.ok === false && (
          <p role='alert' className='text-danger-text text-xs'>
            {descriptionResult.message}
          </p>
        )}
      </form>
      {error && (
        <div role='alert' className='text-danger-text text-[0.8rem] mb-2'>
          {error}
        </div>
      )}
      <h3 className='text-[0.85rem] font-semibold text-text-base mb-2'>Members</h3>
      {renderGroupMemberRows({ busy, members: detail.members, onRemove: removeMember })}
      <form className='flex items-center gap-2 mb-4' action={memberAction}>
        <input type='hidden' name='workspaceSlug' value={slug} />
        <input type='hidden' name='groupId' value={detail.id} />
        <memberForm.Field name='userId'>
          {(field) => (
            <select
              className={INPUT}
              aria-label='Add a member'
              name='userId'
              value={field.state.value}
              disabled={busy}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.currentTarget.value)
              }}
            >
              <option value=''>Add a member…</option>
              {addable.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || member.email}
                </option>
              ))}
            </select>
          )}
        </memberForm.Field>
        <memberForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            dirty: state.isDirty,
            errors: state.errors,
          })}
        >
          {({ canSubmit, dirty, errors }) => (
            <>
              <Button type='submit' variant='primary' disabled={busy || !canSubmit}>
                Add
              </Button>
              {dirty && <FormErrors errors={errors} />}
            </>
          )}
        </memberForm.Subscribe>
        {memberResult?.ok === false && (
          <p role='alert' className='text-danger-text text-xs'>
            {memberResult.message}
          </p>
        )}
      </form>
      <h3 className='text-[0.85rem] font-semibold text-text-base mb-2'>Project grants</h3>
      {renderGroupGrantRows({
        busy,
        grants: detail.grants,
        groupId: detail.id,
        onBusy: setBusy,
        onError: setError,
        onRemove: removeGrant,
        workspaceSlug: slug,
      })}
      <form className='flex flex-wrap items-center gap-2' action={grantAction}>
        <input type='hidden' name='workspaceSlug' value={slug} />
        <input type='hidden' name='groupId' value={detail.id} />
        <grantForm.Field name='projectId'>
          {(field) => (
            <select
              id={`group-grant-project-${detail.id}`}
              name='projectId'
              className={INPUT}
              aria-label='Grant a project'
              value={field.state.value}
              disabled={busy}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.currentTarget.value)
              }}
            >
              <option value=''>Grant a project…</option>
              {grantable.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} ({project.key})
                </option>
              ))}
            </select>
          )}
        </grantForm.Field>
        <grantForm.Field name='role'>
          {(field) => (
            <select
              className={INPUT}
              aria-label='New grant role'
              name='role'
              value={field.state.value}
              disabled={busy}
              onBlur={field.handleBlur}
              onChange={(event) => {
                field.handleChange(event.currentTarget.value)
              }}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          )}
        </grantForm.Field>
        <grantForm.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            dirty: state.isDirty,
            errors: state.errors,
          })}
        >
          {({ canSubmit, dirty, errors }) => (
            <>
              <Button type='submit' variant='primary' disabled={busy || !canSubmit}>
                Grant
              </Button>
              {dirty && <FormErrors errors={errors} />}
            </>
          )}
        </grantForm.Subscribe>
        {grantResult?.ok === false && (
          <p role='alert' className='text-danger-text text-xs'>
            {grantResult.message}
          </p>
        )}
      </form>
    </section>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const GroupManager = function GroupManager({
  workspaceSlug,
  initialData: data,
  view = 'groups',
}: {
  workspaceSlug: string
  initialData: GroupData
  view?: GroupView
}): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [operationBusy, setBusy] = useState(false)
  const [createResult, createAction, createPending] = useActionState(createGroup, null)
  const busy = operationBusy || createPending
  const admin = adminRole(data.role)
  const activeTab = admin ? view : 'groups'
  const detail = data.details.find((item) => item.id === selected)
  const [defaults] = useState(() => ({ workspaceSlug, name: '' }))
  const standard = Schema.toStandardSchemaV1(CreateGroupInputSchema)
  const form = useForm({
    defaultValues: defaults,
    validators: { onMount: standard, onChange: standard, onSubmit: standard },
  })
  useEffect(() => {
    if (createResult?.ok === true) {
      form.reset()
    }
  }, [createResult, form])
  const remove = async function remove(id: string): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      unwrapResult(await deleteGroup({ workspaceSlug, groupId: id }))
      if (selected === id) {
        setSelected(null)
      }
    } catch (currentError) {
      setBusy(false)
      setError(String(currentError))
      return
    }
    setBusy(false)
  }
  const groups = (
    <>
      <section className={CARD}>
        <h2 className={H2}>{admin ? 'Groups' : 'Your groups'}</h2>
        {admin && (
          <form className='flex items-center gap-2 mb-4' action={createAction}>
            <input type='hidden' name='workspaceSlug' value={workspaceSlug} />
            <form.Field name='name'>
              {(field) => (
                <Input
                  aria-label='New group name'
                  name='name'
                  placeholder='New group name'
                  value={field.state.value}
                  maxLength={100}
                  disabled={busy}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value)
                  }}
                />
              )}
            </form.Field>
            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                dirty: state.isDirty,
                errors: state.errors,
              })}
            >
              {({ canSubmit, dirty, errors }) => (
                <>
                  <Button type='submit' variant='primary' disabled={busy || !canSubmit}>
                    Create group
                  </Button>
                  {dirty && <FormErrors errors={errors} />}
                </>
              )}
            </form.Subscribe>
          </form>
        )}
        {createResult?.ok === false && (
          <div role='alert' className='text-danger-text text-[0.8rem] mb-2'>
            {createResult.message}
          </div>
        )}
        {Array.isArrayEmpty(data.groups) ? (
          <EmptyState
            title={
              admin ? 'No groups yet.' : "You don't belong to any groups yet. An owner or admin can add you to one."
            }
          />
        ) : (
          <GroupsList groups={data.groups} admin={admin} busy={busy} onSelect={setSelected} onDelete={remove} />
        )}
      </section>
      {admin && detail && (
        <GroupDetailEditor
          key={detail.id}
          slug={workspaceSlug}
          detail={detail}
          members={data.members}
          projects={data.projects}
          onClose={() => {
            setSelected(null)
          }}
        />
      )}
    </>
  )
  return (
    <div>
      <header className='mb-6'>
        <h1 className='m-0 mb-1 text-2xl font-bold text-text-base'>Groups</h1>
        <p className='m-0 text-sm text-text-muted'>
          Groups grant members access to projects. A member with no groups sees nothing until an admin adds them to a
          group that grants a project.
        </p>
      </header>
      <div className={INFO}>
        <span className={ROLE_TAG}>{data.role}</span>
        <span>
          {admin
            ? 'You manage which groups can access which projects.'
            : 'Only owners and admins manage groups. Below are the groups that grant you access.'}
        </span>
      </div>
      {error && (
        <p role='alert' className='text-danger-text'>
          {error}
        </p>
      )}
      {admin && <GroupSettingsTabs activeTab={activeTab} workspaceSlug={workspaceSlug} />}
      {admin && activeTab === 'members' && (
        <div role='tabpanel' id='group-tabpanel-members' aria-labelledby='group-tab-members'>
          <MembersOverview members={data.members} memberGroups={data.memberGroups} />
        </div>
      )}
      {activeTab === 'groups' &&
        (admin ? (
          <div role='tabpanel' id='group-tabpanel-groups' aria-labelledby='group-tab-groups'>
            {groups}
          </div>
        ) : (
          groups
        ))}
    </div>
  )
}
