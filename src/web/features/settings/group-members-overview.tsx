'use client'

import type { JSX } from 'react'

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table.tsx'

import { MemberGroupsCell } from './group-member-access.tsx'
import { CARD, H2 } from './group-styles.ts'
import type { MemberGroupsRow, WorkspaceMember } from './types.ts'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const MembersOverview = function MembersOverview({
  members,
  memberGroups,
}: {
  members: WorkspaceMember[]
  memberGroups: MemberGroupsRow[]
}): JSX.Element {
  const byUser = new Map(memberGroups.map((row) => [row.userId, row.groups]))
  return (
    <section className={CARD}>
      <h2 className={H2}>Members</h2>
      <div className='overflow-x-auto max-sm:hidden'>
        <Table className='text-[0.85rem]'>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Member</TableHeaderCell>
              <TableHeaderCell>Workspace role</TableHeaderCell>
              <TableHeaderCell>Groups</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className='font-medium text-text-base'>{member.name || member.email}</div>
                  <div className='text-[0.75rem] text-text-muted'>{member.email}</div>
                </TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell>
                  <MemberGroupsCell member={member} groups={byUser.get(member.id) ?? []} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>
        {members.map((member) => (
          <div key={member.id} className='py-3 px-4 border border-border rounded-md bg-surface'>
            <div className='font-medium text-text-base'>{member.name || member.email}</div>
            <div className='text-[0.75rem] text-text-muted mb-1'>{member.email}</div>
            <div className='text-[0.75rem] text-text-muted mb-2'>Role: {member.role}</div>
            <div>
              <MemberGroupsCell member={member} groups={byUser.get(member.id) ?? []} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
