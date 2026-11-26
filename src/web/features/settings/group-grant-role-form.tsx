'use client'

import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { useState } from 'react'
import type { JSX } from 'react'

import { unwrapResult } from '@/client/functions.ts'

import { setGroupGrant } from './actions.ts'
import { ROLES } from './group-roles.ts'
import { INPUT } from './group-styles.ts'
import { GroupGrantInputSchema } from './input-schemas.ts'
import type { GrantRole, GroupGrant } from './types.ts'

const renderGrantRoleOption = (role: GrantRole): JSX.Element => (
  <option key={role} value={role}>
    {role}
  </option>
)

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function GrantRoleForm({
  grant,
  workspaceSlug,
  groupId,
  busy,
  onBusy,
  onError,
}: {
  grant: GroupGrant
  workspaceSlug: string
  groupId: string
  busy: boolean
  onBusy: (busy: boolean) => void
  onError: (error: string | null) => void
}): JSX.Element {
  const [defaults] = useState(() => ({
    workspaceSlug,
    groupId,
    projectId: grant.projectId,
    role: grant.role,
  }))
  const standard = Schema.toStandardSchemaV1(GroupGrantInputSchema)
  const form = useForm({
    defaultValues: defaults,
    validators: { onMount: standard, onChange: standard, onSubmit: standard },
    onSubmit: async ({ value }) => {
      onBusy(true)
      onError(null)
      try {
        unwrapResult(await setGroupGrant(value))
      } catch (error) {
        onBusy(false)
        onError(String(error))
        return
      }
      onBusy(false)
    },
  })
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name='role'>
        {(field) => (
          <select
            className={INPUT}
            aria-label={`Role for ${grant.projectName}`}
            value={grant.role}
            disabled={busy}
            onBlur={field.handleBlur}
            onChange={(event) => {
              field.handleChange(event.currentTarget.value as GrantRole)
              void form.handleSubmit()
            }}
          >
            {ROLES.map((role) => renderGrantRoleOption(role))}
          </select>
        )}
      </form.Field>
    </form>
  )
}
