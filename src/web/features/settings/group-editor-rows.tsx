'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { Button } from '@/components/ui/button.tsx'

import { GrantRoleForm } from './group-grant-role-form.tsx'
import { CHIP } from './group-styles.ts'
import type { GroupDetail } from './types.ts'

export const renderGroupMemberRows = function renderGroupMemberRows({
  busy,
  members,
  onRemove,
}: {
  busy: boolean
  members: GroupDetail['members']
  onRemove: (userId: string) => Promise<void>
}): JSX.Element {
  return (
    <div className='mb-2'>
      {Array.isArrayEmpty(members) && <div className='text-[0.8rem] text-text-muted mb-2'>No members yet.</div>}
      {members.map((member) => (
        <div key={member.userId} className='flex items-center gap-2 mb-1'>
          <span className={CHIP} style={{ margin: 0 }}>
            {member.name || member.email}
          </span>
          <Button
            variant='danger'
            size='sm'
            disabled={busy}
            aria-label={`Remove ${member.name || member.email}`}
            onClick={() => onRemove(member.userId)}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  )
}

export const renderGroupGrantRows = function renderGroupGrantRows({
  busy,
  grants,
  groupId,
  onBusy,
  onError,
  onRemove,
  workspaceSlug,
}: {
  busy: boolean
  grants: GroupDetail['grants']
  groupId: string
  onBusy: (busy: boolean) => void
  onError: (message: string | null) => void
  onRemove: (projectId: string) => Promise<void>
  workspaceSlug: string
}): JSX.Element {
  return (
    <div className='mb-2'>
      {Array.isArrayEmpty(grants) && (
        <div className='text-[0.8rem] text-text-muted mb-2'>No grants. This group opens no projects.</div>
      )}
      {grants.map((grant) => (
        <div key={grant.projectId} className='flex flex-wrap items-center gap-2 mb-1'>
          <span className='text-[0.82rem] text-text-base min-w-[9rem]'>
            {grant.projectName} <span className='text-text-muted'>({grant.projectKey})</span>
          </span>
          <GrantRoleForm
            grant={grant}
            workspaceSlug={workspaceSlug}
            groupId={groupId}
            busy={busy}
            onBusy={onBusy}
            onError={onError}
          />
          <Button
            variant='danger'
            size='sm'
            disabled={busy}
            aria-label={`Remove grant for ${grant.projectName}`}
            onClick={() => onRemove(grant.projectId)}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  )
}
