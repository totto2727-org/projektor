'use client'

import { useState } from 'react'
import type { JSX } from 'react'

import { Button } from '@/components/ui/button.tsx'

import type { NewTokenResult } from './types.ts'

const TOKEN_CODE =
  'flex-1 font-mono text-[0.8rem] px-2 py-[0.375rem] bg-bg border border-border rounded text-text-base break-all'
const MCP_COMMAND =
  'font-mono text-xs px-3 py-2 bg-bg border border-border rounded text-text-muted break-all whitespace-pre-wrap leading-[1.6]'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const NewTokenPanel = function NewTokenPanel({
  token,
  template,
  onDone,
}: {
  token: NewTokenResult
  template: string | null
  onDone: () => void
}): JSX.Element {
  const command = template?.replace('{{TOKEN}}', token.token) ?? ''
  const [copyMessage, setCopyMessage] = useState<string>()
  const copy = async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setCopyMessage('Copied to clipboard.')
    } catch {
      setCopyMessage('Clipboard unavailable. Select and copy the text manually.')
    }
  }
  return (
    <div className='bg-surface border border-border rounded-md p-4 mt-4'>
      <p className='m-0 mb-2 font-semibold text-[0.9rem] text-text-base'>
        Token created: <span className='font-mono text-[0.8rem] text-text-muted'>{token.name}</span>
      </p>
      <p className='text-danger-text text-[0.8rem] my-1'>⚠ Copy this token now. You won't be able to see it again.</p>
      <div className='flex items-center gap-2 my-2'>
        <code className={TOKEN_CODE}>{token.token}</code>
        <Button variant='outline' size='sm' onClick={() => copy(token.token)}>
          Copy
        </Button>
      </div>
      {template && (
        <div className='mt-4'>
          <p className='m-0 mb-[0.375rem] text-[0.8rem] font-semibold text-text-muted'>Connect to Claude:</p>
          <div className={MCP_COMMAND}>{command}</div>
          <Button variant='outline' size='sm' className='mt-2' onClick={() => copy(command)}>
            Copy command
          </Button>
          <p className='m-0 mt-[0.375rem] text-xs text-text-muted'>
            Run this command in your terminal to connect Claude Code to this workspace.
          </p>
        </div>
      )}
      {copyMessage && (
        <p role='status' className='text-xs text-text-muted'>
          {copyMessage}
        </p>
      )}
      <div className='mt-4'>
        <Button variant='outline' size='sm' onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
