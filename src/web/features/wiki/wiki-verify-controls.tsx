'use client'

import type { JSX } from 'react'

import { Button } from '@/components/ui/button.tsx'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiVerifyControls({
  hasVerificationSignal,
  onVerify,
  verifying,
  verifyError,
  isPublicViewer,
}: {
  hasVerificationSignal: boolean
  onVerify: () => void
  verifying: boolean
  verifyError: string | undefined
  isPublicViewer: boolean
}): JSX.Element {
  return (
    <>
      {hasVerificationSignal && !isPublicViewer && (
        <Button variant='outline' size='sm' onClick={onVerify} disabled={verifying}>
          {verifying ? 'Verifying…' : 'Verify'}
        </Button>
      )}
      {verifyError && (
        <span role='alert' className='text-danger-text'>
          {verifyError}
        </span>
      )}
    </>
  )
}
