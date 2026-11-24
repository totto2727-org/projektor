'use client'
import { Predicate } from 'effect'
import { useState } from 'react'
import type { JSX } from 'react'

import { formatTimestampDate } from '@/features/timestamp.ts'

import type { FeedbackSource, FeedbackVersionSummary } from './feedback-source-settings.tsx'
import NewSourceModal from './new-source-modal.tsx'

export interface SourceSummary {
  sourceId: string
  sourceName?: string | null
  totalCount: number
  versions: FeedbackVersionSummary[]
}

interface Props {
  workspaceSlug: string
  projectId: string
  initialSources: Readonly<FeedbackSource[]>
  initialSummaries: Readonly<SourceSummary[]>
}

const formatDate = function formatDate(ts: number): string {
  return formatTimestampDate(ts)
}

const statusLabel = function statusLabel(s: FeedbackSource): string {
  if (Predicate.isNotNullish(s.revokedAt)) {
    return 'Revoked'
  }
  return s.isActive ? 'Active' : 'Inactive'
}

const statusClass = function statusClass(s: FeedbackSource): string {
  if (Predicate.isNotNullish(s.revokedAt)) {
    return 'opacity-60'
  }
  return s.isActive ? '' : 'opacity-75'
}

const CARD_CLASS =
  'flex flex-col gap-2 p-4 bg-surface border border-border rounded-lg no-underline shadow-xs ' +
  'transition-all duration-150 hover:border-accent hover:-translate-y-px'

function SourceCard({
  source,
  summary,
  workspaceSlug,
  projectId,
}: {
  source: FeedbackSource
  summary?: SourceSummary
  workspaceSlug: string
  projectId: string
}): JSX.Element {
  const total = summary?.totalCount ?? 0
  const lastSeenAt = summary?.versions.reduce((max, version) => Math.max(max, version.lastSeenAt), 0) ?? 0
  return (
    <a
      href={`/feedback/${encodeURIComponent(source.id)}?workspace=${encodeURIComponent(workspaceSlug)}&projectId=${encodeURIComponent(projectId)}`}
      className={`${CARD_CLASS} ${statusClass(source)}`}
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='font-bold text-text-base'>{source.name}</span>
        <span className='text-[0.7rem] font-medium px-1.5 py-0.5 rounded bg-bg border border-border text-text-muted'>
          {statusLabel(source)}
        </span>
      </div>
      <span className='text-xs text-text-muted'>{total === 0 ? 'No feedback yet' : `${total} total`}</span>
      <span className='text-xs text-text-muted'>
        {lastSeenAt > 0 ? `Last activity ${formatDate(lastSeenAt)}` : 'No activity yet'}
      </span>
    </a>
  )
}

function NewSourceCard({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`${CARD_CLASS} items-center justify-center text-text-muted font-medium min-h-[104px] cursor-pointer`}
    >
      + New source
    </button>
  )
}

export default function FeedbackSourceGrid({
  workspaceSlug,
  projectId,
  initialSources,
  initialSummaries,
}: Props): JSX.Element {
  const sources = initialSources
  const summaries = initialSummaries
  const [showCreate, setShowCreate] = useState(false)

  const summaryBySource = new Map(summaries.map((s) => [s.sourceId, s]))

  return (
    <section>
      <h1 className='text-xl font-bold text-text-base mb-4'>Feedback sources</h1>
      <div className='grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'>
        {sources.map((s) => (
          <SourceCard
            key={s.id}
            source={s}
            summary={summaryBySource.get(s.id)}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
          />
        ))}
        <NewSourceCard
          onClick={() => {
            setShowCreate(true)
          }}
        />
      </div>
      {showCreate && (
        <NewSourceModal
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          onClose={() => {
            setShowCreate(false)
          }}
        />
      )}
    </section>
  )
}
