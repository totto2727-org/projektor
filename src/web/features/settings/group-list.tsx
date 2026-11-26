'use client'

import { useState } from 'react'
import type { JSX } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table.tsx'

import type { GroupSummary } from './types.ts'

interface GroupListProps {
  groups: GroupSummary[]
  admin: boolean
  busy: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

const renderGroupTableHead = (admin: boolean): JSX.Element => (
  <TableHead>
    <TableRow>
      <TableHeaderCell>Name</TableHeaderCell>
      <TableHeaderCell>Members</TableHeaderCell>
      <TableHeaderCell>Projects</TableHeaderCell>
      {admin && <TableHeaderCell />}
    </TableRow>
  </TableHead>
)

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const GroupsList = function GroupsList({
  groups,
  admin,
  busy,
  onSelect,
  onDelete,
}: GroupListProps): JSX.Element {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const name = (group: GroupSummary): JSX.Element =>
    admin ? (
      <button
        type='button'
        className='text-accent font-medium bg-transparent border-0 cursor-pointer p-0'
        onClick={() => {
          onSelect(group.id)
        }}
      >
        {group.name}
      </button>
    ) : (
      <span className='font-medium text-text-base'>{group.name}</span>
    )
  const remove = (group: GroupSummary): JSX.Element =>
    deleteId === group.id ? (
      <span className='inline-flex gap-2 items-center'>
        <span className='text-xs text-text-muted'>Delete group?</span>
        <Button
          variant='danger'
          size='sm'
          disabled={busy}
          onClick={() => {
            onDelete(group.id)
          }}
        >
          Yes
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          onClick={() => {
            setDeleteId(null)
          }}
        >
          No
        </Button>
      </span>
    ) : (
      <Button
        variant='danger'
        size='sm'
        disabled={busy}
        onClick={() => {
          setDeleteId(group.id)
        }}
      >
        Delete
      </Button>
    )
  const renderGroupRow = (group: GroupSummary): JSX.Element => (
    <TableRow key={group.id}>
      <TableCell>
        {name(group)}
        {group.description && <p className='text-[0.75rem] text-text-muted m-0 mt-1'>{group.description}</p>}
      </TableCell>
      <TableCell>{group.memberCount}</TableCell>
      <TableCell>{group.grantCount}</TableCell>
      {admin && <TableCell>{remove(group)}</TableCell>}
    </TableRow>
  )

  const renderGroupCard = (group: GroupSummary): JSX.Element => (
    <div key={group.id} className='py-3 px-4 border border-border rounded-md bg-surface'>
      <div className='flex justify-between items-center gap-2 mb-1'>
        {name(group)}
        {admin && remove(group)}
      </div>
      {group.description && <p className='text-[0.75rem] text-text-muted m-0 mb-1'>{group.description}</p>}
      <div className='text-[0.75rem] text-text-muted'>
        {group.memberCount} members · {group.grantCount} projects
      </div>
    </div>
  )

  const renderGroupTableBody = (): JSX.Element => <TableBody>{groups.map((group) => renderGroupRow(group))}</TableBody>

  return (
    <>
      <div className='overflow-x-auto max-sm:hidden'>
        <Table className='text-[0.85rem]'>
          {renderGroupTableHead(admin)}
          {renderGroupTableBody()}
        </Table>
      </div>
      <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>
        {groups.map((group) => renderGroupCard(group))}
      </div>
    </>
  )
}
