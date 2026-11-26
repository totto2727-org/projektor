'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { Badge } from '@/components/ui/badge.tsx'

import { adminRole } from './group-roles.ts'
import { CHIP } from './group-styles.ts'
import type { WorkspaceMember } from './types.ts'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const MemberGroupsCell = function MemberGroupsCell({
  member,
  groups,
}: {
  member: WorkspaceMember
  groups: { id: string; name: string }[]
}): JSX.Element {
  if (adminRole(member.role)) {
    return <span className='text-[0.78rem] text-text-muted'>All projects (bypasses groups)</span>
  }
  if (Array.isArrayEmpty(groups)) {
    return <Badge>Pending: no access</Badge>
  }
  return (
    <>
      {groups.map((group) => (
        <span key={group.id} className={CHIP}>
          {group.name}
        </span>
      ))}
    </>
  )
}
