'use client'

import { useForm } from '@tanstack/react-form'
import { Schema } from 'effect'
import { useActionState, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { hasSingleItem } from '#contracts/item-count.ts'
import { unwrapResult } from '@/client/functions.ts'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { FormErrors } from '@/features/planning/form-ui.tsx'

import { createToken, revokeToken } from './actions.ts'
import { CreateTokenInputSchema } from './input-schemas.ts'
import { NewTokenPanel } from './new-token-panel.tsx'
import type { RevokeState } from './token-revoke-control.tsx'
import { TokenTable } from './token-table.tsx'
import type { NewTokenResult, Token } from './types.ts'

export { formatTokenScopes } from './token-scope-label.ts'

/**
 * The one-time secret is client-only mutation state. The token list always comes from SSR.
 *
 * @param {{ workspaceSlug: string; initialTokens: Token[]; mcpUrl: string | null; mcpCommandTemplate?: string | null }} props The workspace, server-supplied token list, and optional MCP command template.
 * @returns {JSX.Element} The token list and controls for creating and revoking tokens.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TokenManager = function TokenManager({
  workspaceSlug,
  initialTokens: tokens,
  mcpCommandTemplate = null,
}: {
  workspaceSlug: string
  initialTokens: Token[]
  mcpUrl: string | null
  mcpCommandTemplate?: string | null
}): JSX.Element {
  const [showCreate, setShowCreate] = useState(false)
  const [error, setError] = useState<string>()
  const [newToken, setNewToken] = useState<NewTokenResult>()
  const [revokeId, setRevokeId] = useState<string>()
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string>()
  const [createResult, createAction, creating] = useActionState(createToken, null)
  useEffect(() => {
    if (!createResult) {
      return
    }
    if (createResult.ok) {
      setNewToken(createResult.value)
      setError(undefined)
    } else {
      setError(createResult.message)
    }
  }, [createResult])
  const inputRef = useRef<HTMLInputElement>(null)
  const [defaults] = useState(() => ({
    workspaceSlug,
    name: '',
    scope: 'readwrite' as 'read' | 'readwrite',
    expiry: '',
  }))
  const standard = Schema.toStandardSchemaV1(CreateTokenInputSchema)
  const form = useForm({
    defaultValues: defaults,
    validators: { onMount: standard, onChange: standard, onSubmit: standard },
  })
  const open = function open(): void {
    setShowCreate(true)
    form.reset()
    setError(undefined)
    setNewToken(undefined)
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  const close = function close(): void {
    setShowCreate(false)
    setNewToken(undefined)
    setError(undefined)
  }
  const revoke = async function revoke(id: string): Promise<void> {
    if (revoking) {
      return
    }
    setRevoking(true)
    setRevokeError(undefined)
    try {
      unwrapResult(await revokeToken({ workspaceSlug, tokenId: id }))
      setRevokeId(undefined)
    } catch (currentError) {
      setRevoking(false)
      setRevokeError(String(currentError))
      return
    }
    setRevoking(false)
  }
  const state: RevokeState = {
    id: revokeId,
    busy: revoking,
    error: revokeError,
    select: (id) => {
      setRevokeId(id)
      setRevokeError(undefined)
    },
    cancel: () => {
      setRevokeId(undefined)
    },
    confirm: revoke,
  }
  interface TokenScopeField {
    state: { value: (typeof defaults)['scope'] }
    handleBlur: () => void
    handleChange: (value: (typeof defaults)['scope']) => void
  }

  const renderTokenScopeOptions = (field: TokenScopeField): JSX.Element => (
    <>
      <label className='flex items-center gap-2 cursor-pointer text-sm text-text-base'>
        <input
          type='radio'
          name='scope'
          value='readwrite'
          checked={field.state.value === 'readwrite'}
          disabled={creating}
          onBlur={field.handleBlur}
          onChange={() => {
            field.handleChange('readwrite')
          }}
        />
        Read + Write (recommended)
      </label>
      <label className='flex items-center gap-2 cursor-pointer text-sm text-text-base'>
        <input
          type='radio'
          name='scope'
          value='read'
          checked={field.state.value === 'read'}
          disabled={creating}
          onBlur={field.handleBlur}
          onChange={() => {
            field.handleChange('read')
          }}
        />
        Read-only
      </label>
    </>
  )

  const renderTokenScopeField = (): JSX.Element => <form.Field name='scope'>{renderTokenScopeOptions}</form.Field>

  const renderTokenNameField = (): JSX.Element => (
    <div className='flex flex-col gap-1 mb-[0.875rem]'>
      <label className='text-[0.8rem] font-semibold text-text-muted' htmlFor='tok-name'>
        Name *
      </label>
      <form.Field name='name'>
        {(field) => (
          <Input
            inputRef={inputRef}
            id='tok-name'
            name='name'
            type='text'
            placeholder='e.g. Claude Code agent'
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => {
              field.handleChange(event.currentTarget.value)
            }}
            disabled={creating}
            required
            maxLength={100}
          />
        )}
      </form.Field>
    </div>
  )

  const renderTokenScope = (): JSX.Element => (
    <div className='flex flex-col gap-1 mb-[0.875rem]'>
      <span className='text-[0.8rem] font-semibold text-text-muted'>Scope</span>
      <div className='flex flex-col gap-[0.375rem]'>{renderTokenScopeField()}</div>
    </div>
  )

  const renderTokenExpiryField = (): JSX.Element => (
    <div className='flex flex-col gap-1 mb-[0.875rem]'>
      <label className='text-[0.8rem] font-semibold text-text-muted' htmlFor='tok-expiry'>
        Expires in (days, optional)
      </label>
      <form.Field name='expiry'>
        {(field) => (
          <Input
            id='tok-expiry'
            name='expiry'
            className='sm:max-w-[240px]'
            type='number'
            min={1}
            max={365}
            placeholder='e.g. 90 (leave blank for no expiry)'
            value={field.state.value}
            disabled={creating}
            onBlur={field.handleBlur}
            onChange={(event) => {
              field.handleChange(event.currentTarget.value)
            }}
          />
        )}
      </form.Field>
    </div>
  )

  interface TokenFormStatus {
    canSubmit: boolean
    errors: typeof form.state.errors
    dirty: boolean
  }

  const renderTokenFormFields = ({ canSubmit, errors, dirty }: TokenFormStatus): JSX.Element => (
    <>
      <h3 className='m-0 mb-4 text-base font-semibold text-text-base'>New API token</h3>
      {renderTokenNameField()}
      {renderTokenScope()}
      {renderTokenExpiryField()}
      {error && (
        <p role='alert' className='text-danger-text text-[0.8rem] m-0 mb-3'>
          {error}
        </p>
      )}
      <div className='flex gap-2'>
        {dirty && <FormErrors errors={errors} />}
        <Button type='submit' variant='primary' size='sm' disabled={creating || !canSubmit}>
          {creating ? 'Creating…' : 'Create token'}
        </Button>
        <Button variant='outline' size='sm' disabled={creating} onClick={close}>
          Cancel
        </Button>
      </div>
    </>
  )

  const renderTokenCreateForm = (): JSX.Element => (
    <form action={createAction}>
      <input type='hidden' name='workspaceSlug' value={workspaceSlug} />
      <form.Subscribe<TokenFormStatus>
        selector={(formState) => ({
          canSubmit: formState.canSubmit,
          errors: formState.errors,
          dirty: formState.isDirty,
        })}
      >
        {renderTokenFormFields}
      </form.Subscribe>
    </form>
  )

  return (
    <div>
      <div className='flex justify-between items-center mb-5'>
        <p className='m-0 text-sm text-text-muted'>
          {tokens.length} token{!hasSingleItem(tokens) ? 's' : ''}
        </p>
        {!showCreate && (
          <Button variant='primary' size='sm' onClick={open}>
            + New token
          </Button>
        )}
      </div>
      {showCreate && (
        <div className='mb-6 px-5 py-4 bg-surface border border-border rounded-lg'>
          {newToken ? (
            <NewTokenPanel token={newToken} template={mcpCommandTemplate} onDone={close} />
          ) : (
            renderTokenCreateForm()
          )}
        </div>
      )}
      <TokenTable tokens={tokens} state={state} />
    </div>
  )
}
