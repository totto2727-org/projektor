'use client'
import { Array, Predicate } from 'effect'

import { ReviewTargetsSummary } from '@/features/issues/components/review-targets-summary.tsx'
import { formatIssueRef } from '@/features/issues/lib/issue-ref.ts'
import { issueUrl } from '@/features/issues/utils/issue-url.ts'

import type { SearchResult } from './use-issue-search.ts'

const priorityBadge = function priorityBadge(result: SearchResult) {
  return (
    <span
      className='inline-flex items-center px-1.5 py-0.5 rounded text-[0.7rem] font-semibold capitalize whitespace-nowrap'
      style={{
        background: `var(--priority-${result.priority}-bg, var(--priority-low-bg))`,
        color: `var(--priority-${result.priority}-text, var(--text-muted))`,
      }}
    >
      {result.priority === 'none' ? '–' : result.priority}
    </span>
  )
}

const statusBadge = function statusBadge(result: SearchResult) {
  return <span className='font-medium text-sm text-text-muted'>{result.status.replace(/_/gu, ' ')}</span>
}

const SearchResultsTable = function SearchResultsTable({ results }: { results: SearchResult[] }) {
  return (
    <div className='overflow-x-auto max-sm:hidden'>
      <table className='w-full border-collapse text-[0.9rem]'>
        <thead>
          <tr className='bg-surface'>
            <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
              #
            </th>
            <th className='text-left px-3 py-2 border-b-2 border-border font-semibold w-full text-text-base'>Title</th>
            <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
              Priority
            </th>
            <th className='text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base'>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id} className='border-b border-border'>
              <td className='px-3 py-2 align-middle whitespace-nowrap'>
                <span className='text-text-muted font-mono text-[0.8rem]'>
                  {formatIssueRef(result.project_key, result.number)}
                </span>
              </td>
              <td className='px-3 py-2 align-middle text-text-base'>
                <a
                  href={issueUrl(result.project_key, result.number, result.title, result.id, result.workspaceSlug)}
                  className='text-text-base no-underline hover:underline focus:underline'
                >
                  {result.title}
                </a>
                <ReviewTargetsSummary issue={result} />
              </td>
              <td className='px-3 py-2 align-middle whitespace-nowrap'>{priorityBadge(result)}</td>
              <td className='px-3 py-2 align-middle whitespace-nowrap'>{statusBadge(result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SearchResultsMobileCards = function SearchResultsMobileCards({ results }: { results: SearchResult[] }) {
  return (
    <div className='hidden max-sm:flex max-sm:flex-col max-sm:gap-3'>
      {results.map((result) => (
        <div key={result.id} className='py-3 px-4 border border-border rounded-md bg-surface'>
          <span className='inline-block font-mono text-[0.8rem] text-text-muted mb-1'>
            {formatIssueRef(result.project_key, result.number)}
          </span>
          <a
            href={issueUrl(result.project_key, result.number, result.title, result.id, result.workspaceSlug)}
            className='no-underline'
          >
            <div className='text-[0.9rem] text-text-base font-medium mb-2'>{result.title}</div>
          </a>
          <ReviewTargetsSummary issue={result} />
          <div className='flex gap-[0.375rem] flex-wrap items-center'>
            {priorityBadge(result)}
            {statusBadge(result)}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SearchResultsSection({
  searchLoading,
  searchResults,
  searchQuery,
}: {
  searchLoading: boolean
  searchResults: SearchResult[] | null
  searchQuery: string
}) {
  if (searchLoading) {
    return (
      <p aria-live='polite' className='text-text-muted'>
        Searching…
      </p>
    )
  }
  if (Predicate.isNullish(searchResults)) {
    return null
  }
  if (Array.isArrayEmpty(searchResults)) {
    return <p className='text-text-muted'>No results for «{searchQuery.trim()}»</p>
  }
  return (
    <>
      <SearchResultsTable results={searchResults} />
      <SearchResultsMobileCards results={searchResults} />
    </>
  )
}
