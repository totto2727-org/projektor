'use client'

import { Predicate } from 'effect'
import type { JSX } from 'react'

import { MILLISECONDS_PER_SECOND, currentEpochMilliseconds } from '#contracts/time.ts'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table.tsx'
import { formatTimestampDate } from '@/features/timestamp.ts'

import { TokenRevokeControl } from './token-revoke-control.tsx'
import type { RevokeState } from './token-revoke-control.tsx'
import { formatTokenScopes } from './token-scope-label.ts'
import type { Token } from './types.ts'

const formatDate = function formatDate(timestamp: number | null): string {
  return Predicate.isNullish(timestamp) ? 'Never' : formatTimestampDate(timestamp)
}

const renderTokenHeaderRow = (): JSX.Element => (
  <TableRow>
    <TableHeaderCell>Name</TableHeaderCell>
    <TableHeaderCell>Scope</TableHeaderCell>
    <TableHeaderCell>Created</TableHeaderCell>
    <TableHeaderCell>Expires</TableHeaderCell>
    <TableHeaderCell>Last used</TableHeaderCell>
    <TableHeaderCell />
  </TableRow>
)

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TokenTable = function TokenTable({ tokens, state }: { tokens: Token[]; state: RevokeState }): JSX.Element {
  if (!tokens.length) {
    return (
      <EmptyState
        className='bg-surface rounded-lg border border-border'
        title='No API tokens yet.'
        description='Create a token to allow agents and scripts to authenticate.'
      />
    )
  }
  const renderTokenRows = (): JSX.Element[] =>
    tokens.map((token) => {
      const renderTokenRevokeCell = (): JSX.Element => (
        <TableCell className='whitespace-nowrap'>
          <TokenRevokeControl token={token} state={state} />
        </TableCell>
      )
      return (
        <TableRow key={token.id}>
          <TableCell className='text-text-base font-medium'>{token.name}</TableCell>
          <TableCell muted>{formatTokenScopes(token.scopes)}</TableCell>
          <TableCell muted>{formatDate(token.createdAt)}</TableCell>
          <TableCell
            className={`font-mono text-[0.8rem] ${Predicate.isNotNullish(token.expiresAt) && token.expiresAt < currentEpochMilliseconds() / MILLISECONDS_PER_SECOND ? 'text-danger-text' : 'text-text-muted'}`}
          >
            {Predicate.isNullish(token.expiresAt) ? 'No expiry' : formatDate(token.expiresAt)}
          </TableCell>
          <TableCell muted>{formatDate(token.lastUsedAt)}</TableCell>
          {renderTokenRevokeCell()}
        </TableRow>
      )
    })
  const renderDesktopTokenTable = (): JSX.Element => (
    <Table>
      <TableHead>{renderTokenHeaderRow()}</TableHead>
      <TableBody>{renderTokenRows()}</TableBody>
    </Table>
  )
  const renderMobileTokenCards = (): JSX.Element[] =>
    tokens.map((token) => {
      const renderTokenFacts = (): JSX.Element => (
        <dl className='grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.8rem] text-text-muted mb-3'>
          <dt className='font-semibold'>Scope</dt>
          <dd className='m-0'>{formatTokenScopes(token.scopes)}</dd>
          <dt className='font-semibold'>Created</dt>
          <dd className='m-0'>{formatDate(token.createdAt)}</dd>
          <dt className='font-semibold'>Expires</dt>
          <dd
            className={`m-0 ${Predicate.isNotNullish(token.expiresAt) && token.expiresAt < currentEpochMilliseconds() / MILLISECONDS_PER_SECOND ? 'text-danger-text' : ''}`}
          >
            {Predicate.isNullish(token.expiresAt) ? 'No expiry' : formatDate(token.expiresAt)}
          </dd>
          <dt className='font-semibold'>Last used</dt>
          <dd className='m-0'>{formatDate(token.lastUsedAt)}</dd>
        </dl>
      )
      return (
        <div key={token.id} className='py-3 px-4 border border-border rounded-md bg-surface'>
          <div className='text-[0.9rem] text-text-base font-medium mb-2'>{token.name}</div>
          {renderTokenFacts()}
          <TokenRevokeControl token={token} state={state} />
        </div>
      )
    })
  return (
    <>
      <div className='overflow-x-auto max-sm:hidden'>{renderDesktopTokenTable()}</div>
      <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>{renderMobileTokenCards()}</div>
    </>
  )
}
