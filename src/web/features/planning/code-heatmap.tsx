'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { SectionHeading } from './metric-help.tsx'
import type { CodeHeatmapEntry, CodeHeatmapResponse, HeatmapMode } from './types.ts'

const SINGLE_ISSUE_COUNT = 1
const MIN_HEAT_INTENSITY_PERCENT = 14
const HEAT_INTENSITY_RANGE_PERCENT = 70
const NO_ISSUES = 0
const MIN_BAR_PERCENT = 4
const FULL_BAR_PERCENT = 100
const MIN_SCALE_ISSUE_COUNT = 1
const FIRST_BREADCRUMB_INDEX = 0
const BREADCRUMB_INDEX_STEP = 1

const issueCount = function issueCount(count: number): string {
  return `${count} ${count === SINGLE_ISSUE_COUNT ? 'issue' : 'issues'}`
}
const heatBackground = function heatBackground(ratio: number): string {
  return `color-mix(in srgb, var(--accent) ${MIN_HEAT_INTENSITY_PERCENT + Math.round(HEAT_INTENSITY_RANGE_PERCENT * ratio)}%, var(--surface))`
}
export const heatmapHref = function heatmapHref(initialUrl: string, mode: HeatmapMode, prefix: string): string {
  const url = new URL(initialUrl)
  url.searchParams.set('heatmapMode', mode)
  if (prefix) {
    url.searchParams.set('prefix', prefix)
  } else {
    url.searchParams.delete('prefix')
  }
  return `${url.pathname}?${url.searchParams}`
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const HeatmapRow = function HeatmapRow({
  entry,
  mode,
  ratio,
  href,
}: {
  entry: CodeHeatmapEntry
  mode: HeatmapMode
  ratio: number
  href: string
}): JSX.Element {
  const count =
    mode === 'contention' ? (entry.distinctRejectedIssueCount ?? NO_ISSUES) : (entry.distinctIssueCount ?? NO_ISSUES)
  const content = (
    <>
      <span className='min-w-0 truncate text-[0.82rem] text-text-base' title={entry.path}>
        {entry.segment}
        {entry.isLeaf ? '' : '/'}
      </span>
      <span
        className='flex-1 min-w-[60px] h-5 rounded-[3px] overflow-hidden'
        style={{ background: 'color-mix(in srgb, var(--border) 30%, transparent)' }}
      >
        <span
          className='block h-full rounded-r-[4px]'
          style={{
            width: `${Math.max(MIN_BAR_PERCENT, ratio * FULL_BAR_PERCENT)}%`,
            background: heatBackground(ratio),
          }}
        />
      </span>
      <span className='w-[5.5rem] shrink-0 text-right text-[0.78rem] tabular-nums text-text-muted'>
        {issueCount(count)}
      </span>
    </>
  )
  const rowClass = 'grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3 py-1 px-2 rounded'
  return entry.isLeaf ? (
    <div className={rowClass}>{content}</div>
  ) : (
    <a
      href={href}
      className={`${rowClass} w-full text-left no-underline hover:bg-border cursor-pointer`}
      title={`View files under ${entry.path}`}
    >
      {content}
    </a>
  )
}
/**
 * Claim/contention and breadcrumb drill-down are shareable server navigations, never mount fetches.
 *
 * @param {{ data: CodeHeatmapResponse | null; mode: HeatmapMode; initialUrl: string; error?: string | null }} props The heatmap response, active count mode, current URL, and optional error.
 * @returns {JSX.Element} The selected code heatmap with path navigation and its empty or error state.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const CodeHeatmap = function CodeHeatmap({
  data,
  mode,
  initialUrl,
  error,
}: {
  data: CodeHeatmapResponse | null
  mode: HeatmapMode
  initialUrl: string
  error?: string | null
}): JSX.Element {
  const countField = mode === 'contention' ? 'distinctRejectedIssueCount' : 'distinctIssueCount'
  const maxCount = data
    ? Math.max(MIN_SCALE_ISSUE_COUNT, ...data.entries.map((entry) => entry[countField] ?? NO_ISSUES))
    : MIN_SCALE_ISSUE_COUNT
  const segments = isNonEmptyText(data?.prefix) ? data.prefix.split('/') : []
  return (
    <div className='mb-8'>
      <SectionHeading
        metricId={mode === 'contention' ? 'code-heatmap-contention' : 'code-heatmap'}
        caption={
          mode === 'contention'
            ? 'Directories sized by distinct issues whose claim was rejected or overridden there. Click a row to drill in'
            : 'Directories sized by distinct issues claiming files there. Click a row to drill in'
        }
      />
      <div className='p-4 bg-surface border border-border rounded-lg'>
        <nav className='flex flex-wrap items-center gap-1 mb-3 text-[0.78rem]' aria-label='Heatmap mode'>
          {(['claims', 'contention'] as const).map((value) => (
            <a
              key={value}
              href={heatmapHref(initialUrl, value, '')}
              aria-current={mode === value ? 'page' : undefined}
              className={`px-1.5 py-0.5 rounded no-underline hover:bg-border ${mode === value ? 'font-semibold text-text-base' : 'text-accent'}`}
            >
              {value === 'claims' ? 'Claim volume' : 'Contention'}
            </a>
          ))}
        </nav>
        {error && (
          <p role='alert' className='text-danger-text'>
            {error}
          </p>
        )}
        {data && (
          <>
            <nav className='flex flex-wrap items-center gap-1 mb-3 text-[0.78rem]' aria-label='Heatmap breadcrumb'>
              <a
                href={heatmapHref(initialUrl, mode, '')}
                className={`px-1.5 py-0.5 rounded no-underline hover:bg-border ${Array.isArrayEmpty(segments) ? 'font-semibold text-text-base' : 'text-accent'}`}
              >
                All files
              </a>
              {segments.map((segment, index) => {
                const path = segments.slice(FIRST_BREADCRUMB_INDEX, index + BREADCRUMB_INDEX_STEP).join('/')
                return (
                  <span key={path} className='flex items-center gap-1'>
                    <span className='text-text-muted'>/</span>
                    <a
                      href={heatmapHref(initialUrl, mode, path)}
                      className={`px-1.5 py-0.5 rounded no-underline hover:bg-border ${index === segments.length - BREADCRUMB_INDEX_STEP ? 'font-semibold text-text-base' : 'text-accent'}`}
                    >
                      {segment}
                    </a>
                  </span>
                )
              })}
            </nav>
            {Array.isArrayEmpty(data.entries) ? (
              <div className='py-8 text-center'>
                <p className='m-0 text-sm text-text-base'>
                  {mode === 'contention' ? 'No claim conflicts in this window' : 'No file claims in this window yet'}
                </p>
                <p className='m-0 mt-1 text-[0.78rem] text-text-muted'>
                  {mode === 'contention' ? (
                    "Agents aren't queuing up over the same files. That's a healthy sign for fleet parallelism."
                  ) : (
                    <>
                      This view is fed by <code className='text-[0.78rem]'>claim_files</code>. It fills in once agents
                      claim files while working issues on this project.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className='flex flex-col gap-0.5'>
                {data.entries.map((entry) => (
                  <HeatmapRow
                    key={entry.path}
                    entry={entry}
                    mode={mode}
                    ratio={(entry[countField] ?? NO_ISSUES) / maxCount}
                    href={heatmapHref(initialUrl, mode, entry.path)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
