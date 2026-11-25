'use client'

import type { JSX } from 'react'

import { Button } from '@/components/ui/button.tsx'

import type { Token } from './types.ts'

export interface RevokeState {
  id: string | null
  busy: boolean
  error: string | null
  select: (id: string) => void
  cancel: () => void
  confirm: (id: string) => void
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TokenRevokeControl = function TokenRevokeControl({
  token,
  state,
}: {
  token: Token
  state: RevokeState
}): JSX.Element {
  if (state.id === token.id) {
    return (
      <span className='inline-flex gap-[0.375rem] items-center flex-wrap'>
        <span className='text-[0.8rem] text-text-muted'>Revoke?</span>
        <Button
          variant='danger'
          size='sm'
          disabled={state.busy}
          onClick={() => {
            state.confirm(token.id)
          }}
        >
          {state.busy ? '…' : 'Yes'}
        </Button>
        <Button variant='outline' size='sm' disabled={state.busy} onClick={state.cancel}>
          No
        </Button>
        {state.error && (
          <span role='alert' className='text-danger-text text-xs'>
            {state.error}
          </span>
        )}
      </span>
    )
  }
  return (
    <Button
      variant='outline'
      size='sm'
      className='text-danger-text border-danger-border'
      disabled={state.busy}
      onClick={() => {
        state.select(token.id)
      }}
    >
      Revoke
    </Button>
  )
}
