'use client'
import { Array, Predicate } from 'effect'
import type { JSX } from 'react'

import type { SourceSummary } from './feedback-source-grid.tsx'
import type { FeedbackVersionSummary } from './feedback-source-settings.tsx'

interface Props {
  workspaceSlug?: string
  projectId: string
  sourceId: string
  initialSummary: SourceSummary | null
}

const versionMetric = function versionMetric(version: FeedbackVersionSummary): string {
  const parts: string[] = []
  if (Predicate.isNotNullish(version.thumbsUpPct)) {
    parts.push(`👍 ${version.thumbsUpPct}%`)
  }
  if (Predicate.isNotNullish(version.avgFiveStar)) {
    parts.push(`${version.avgFiveStar.toFixed(1)}★ avg`)
  }
  return Array.isArrayEmpty(parts) ? 'No ratings' : parts.join(' · ')
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function FeedbackSummary({ initialSummary: summary }: Props): JSX.Element {
  if (!summary || Array.isArrayEmpty(summary.versions)) {
    return (
      <div className='p-6 text-center text-text-muted bg-surface rounded-lg border border-border'>No feedback yet.</div>
    )
  }

  return (
    <section className='flex flex-col gap-4'>
      <div className='bg-surface rounded-lg border border-border p-4'>
        <div className='flex items-baseline gap-2 mb-2'>
          <span className='text-[0.8rem] text-text-muted'>{summary.totalCount} total</span>
        </div>
        <ul className='flex flex-col gap-1'>
          {summary.versions.map((version) => (
            <li
              key={version.appVersion ?? 'unknown'}
              className='flex flex-wrap gap-x-3 text-[0.875rem] text-text-muted'
            >
              <span className='font-medium text-text-base'>{version.appVersion ?? 'Unknown version'}</span>
              <span>{versionMetric(version)}</span>
              {version.withCommentCount > 0 && <span>{version.withCommentCount} with comments</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
