'use client'

import { SectionHeading } from './MetricHelp'
import type { CodeHeatmapEntry, CodeHeatmapResponse, HeatmapMode } from './types'

function issueCount(count: number): string {
  return `${count} ${count === 1 ? 'issue' : 'issues'}`
}
function heatBackground(ratio: number): string {
  return `color-mix(in srgb, var(--accent) ${14 + Math.round(70 * ratio)}%, var(--surface))`
}
export function heatmapHref(initialUrl: string, mode: HeatmapMode, prefix: string): string {
  const url = new URL(initialUrl)
  url.searchParams.set('heatmapMode', mode)
  if (prefix) url.searchParams.set('prefix', prefix)
  else url.searchParams.delete('prefix')
  return `${url.pathname}?${url.searchParams}`
}
function HeatmapRow({
  entry,
  mode,
  ratio,
  href,
}: {
  entry: CodeHeatmapEntry
  mode: HeatmapMode
  ratio: number
  href: string
}) {
  const count = mode === 'contention' ? (entry.distinctRejectedIssueCount ?? 0) : (entry.distinctIssueCount ?? 0)
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
          style={{ width: `${Math.max(4, ratio * 100)}%`, background: heatBackground(ratio) }}
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
/** Claim/contention and breadcrumb drill-down are shareable server navigations, never mount fetches. */
export function CodeHeatmap({
  data,
  mode,
  initialUrl,
  error,
}: {
  data: CodeHeatmapResponse | null
  mode: HeatmapMode
  initialUrl: string
  error?: string | null
}) {
  const countField = mode === 'contention' ? 'distinctRejectedIssueCount' : 'distinctIssueCount'
  const maxCount = data ? Math.max(1, ...data.entries.map((entry) => entry[countField] ?? 0)) : 1
  const segments = data?.prefix ? data.prefix.split('/') : []
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
                className={`px-1.5 py-0.5 rounded no-underline hover:bg-border ${segments.length === 0 ? 'font-semibold text-text-base' : 'text-accent'}`}
              >
                All files
              </a>
              {segments.map((segment, index) => {
                const path = segments.slice(0, index + 1).join('/')
                return (
                  <span key={path} className='flex items-center gap-1'>
                    <span className='text-text-muted'>/</span>
                    <a
                      href={heatmapHref(initialUrl, mode, path)}
                      className={`px-1.5 py-0.5 rounded no-underline hover:bg-border ${index === segments.length - 1 ? 'font-semibold text-text-base' : 'text-accent'}`}
                    >
                      {segment}
                    </a>
                  </span>
                )
              })}
            </nav>
            {data.entries.length === 0 ? (
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
                    ratio={(entry[countField] ?? 0) / maxCount}
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
