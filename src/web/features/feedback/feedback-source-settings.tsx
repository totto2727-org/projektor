'use client'

import { useRef, useState } from 'react'
import type { JSX } from 'react'

import { unwrapResult } from '@/client/functions.ts'
import { Button } from '@/components/ui/button.tsx'
import { formatTimestampDate } from '@/features/timestamp.ts'

import { revokeFeedbackSource, rotateFeedbackSourceToken, setFeedbackSourceActive } from './actions.ts'

export interface FeedbackSource {
  id: string
  name: string
  description: string | null
  isActive: boolean
  allowedOrigins: string[] | null
  tokenPreview: string
  createdAt: number
  revokedAt: number | null
}

export interface FeedbackVersionSummary {
  appVersion: string | null
  totalCount: number
  withCommentCount: number
  thumbsUpPct: number | null
  avgFiveStar: number | null
  lastSeenAt: number
}

interface Props {
  source: FeedbackSource
  projectId: string
  workspaceSlug?: string
  onChanged?: () => void
}

const formatDate = function formatDate(ts: number): string {
  return formatTimestampDate(ts)
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const NewTokenReveal = function NewTokenReveal({
  token,
  onDismiss,
}: {
  token: string
  onDismiss: () => void
}): JSX.Element {
  return (
    <div className='bg-surface border border-border rounded-md p-4'>
      <p className='text-danger-text text-[0.8rem] my-1'>⚠ Copy this token now — you won't be able to see it again.</p>
      <code className='block font-mono text-[0.8rem] px-2 py-[0.375rem] bg-bg border border-border rounded break-all'>
        {token}
      </code>
      <Button variant='outline' size='sm' className='mt-2' onClick={onDismiss}>
        Done
      </Button>
    </div>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const DangerZone = function DangerZone({
  busy,
  rotating,
  onRotateStart,
  onRotateCancel,
  onRotateConfirm,
  onRevoke,
}: {
  busy: boolean
  rotating: boolean
  onRotateStart: () => void
  onRotateCancel: () => void
  onRotateConfirm: () => void
  onRevoke: () => void
}): JSX.Element {
  return (
    <div className='flex flex-col gap-2'>
      <span className='text-[0.8rem] font-semibold text-text-muted'>Danger zone</span>
      {rotating ? (
        <span className='inline-flex gap-[0.375rem] items-center flex-wrap'>
          <span className='text-[0.8rem] text-text-muted'>Rotate? Old token dies.</span>
          <Button variant='danger' size='sm' onClick={onRotateConfirm} disabled={busy}>
            {busy ? 'Rotating…' : 'Yes'}
          </Button>
          <Button variant='outline' size='sm' onClick={onRotateCancel} disabled={busy}>
            No
          </Button>
        </span>
      ) : (
        <span className='inline-flex gap-[0.375rem]'>
          <Button variant='outline' size='sm' onClick={onRotateStart}>
            Rotate token
          </Button>
          <Button variant='outline' size='sm' className='text-danger-text border-danger-border' onClick={onRevoke}>
            Revoke source
          </Button>
        </span>
      )}
    </div>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function FeedbackSourceSettings({ source, projectId, workspaceSlug, onChanged }: Props): JSX.Element {
  const rotationInFlight = useRef(false)
  const [rotationBusy, setRotationBusy] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleActive(): Promise<void> {
    try {
      unwrapResult(
        await setFeedbackSourceActive({
          workspaceSlug,
          projectId,
          sourceId: source.id,
          active: !source.isActive,
        }),
      )
      onChanged?.()
    } catch (caughtError) {
      setError(String(caughtError))
    }
  }

  async function confirmRotate(): Promise<void> {
    if (rotationInFlight.current) {
      return
    }
    rotationInFlight.current = true
    setRotationBusy(true)
    setError(null)
    try {
      const result = unwrapResult(await rotateFeedbackSourceToken({ workspaceSlug, projectId, sourceId: source.id }))
      setRotating(false)
      setNewToken(result.token)
      onChanged?.()
    } catch (caughtError) {
      rotationInFlight.current = false
      setRotationBusy(false)
      setError(String(caughtError))
      return
    }
    rotationInFlight.current = false
    setRotationBusy(false)
  }

  async function revoke(): Promise<void> {
    if (!window.confirm(`Revoke ${source.name}? Its token will stop accepting feedback.`)) {
      return
    }
    try {
      unwrapResult(await revokeFeedbackSource({ workspaceSlug, projectId, sourceId: source.id }))
      onChanged?.()
    } catch (caughtError) {
      setError(String(caughtError))
    }
  }

  return (
    <section className='flex flex-col gap-4 max-w-[520px]'>
      {error && (
        <p role='alert' className='text-danger-text'>
          {error}
        </p>
      )}

      {newToken && (
        <NewTokenReveal
          token={newToken}
          onDismiss={() => {
            setNewToken(null)
          }}
        />
      )}

      <div className='flex flex-col gap-1'>
        <span className='text-[0.8rem] font-semibold text-text-muted'>Token</span>
        <code className='font-mono text-[0.85rem]'>{source.tokenPreview}</code>
      </div>

      <div className='flex flex-col gap-1'>
        <span className='text-[0.8rem] font-semibold text-text-muted'>Status</span>
        <Button variant='outline' size='sm' className='w-fit' onClick={toggleActive}>
          {source.isActive ? 'Active' : 'Inactive'}
        </Button>
      </div>

      <div className='flex flex-col gap-1'>
        <span className='text-[0.8rem] font-semibold text-text-muted'>Created</span>
        <span className='text-[0.875rem] text-text-base'>{formatDate(source.createdAt)}</span>
      </div>

      <DangerZone
        busy={rotationBusy}
        rotating={rotating}
        onRotateStart={() => {
          setRotating(true)
        }}
        onRotateCancel={() => {
          setRotating(false)
        }}
        onRotateConfirm={confirmRotate}
        onRevoke={revoke}
      />
    </section>
  )
}
