'use client'
import { String, Predicate } from 'effect'
import { useRef } from 'react'
import type { JSX } from 'react'

import { hasMultipleItems } from '#contracts/item-count.ts'
import { Select } from '@/components/ui/select.tsx'
import { navigateFeature } from '@/features/wiki/navigation.ts'

import type { Feedback } from './feedback-list.tsx'
import { FeedbackList } from './feedback-list.tsx'
import type { SourceSummary } from './feedback-source-grid.tsx'
import { FeedbackSourceSettings } from './feedback-source-settings.tsx'
import type { FeedbackSource } from './feedback-source-settings.tsx'
import { FeedbackSummary } from './feedback-summary.tsx'

export interface FeedbackDetailProps {
  workspaceSlug: string
  projectId: string
  initialSource: FeedbackSource
  initialSources: Readonly<FeedbackSource[]>
  initialRows: Readonly<Feedback[]>
  initialSummary: SourceSummary | null
  initialStatus?: string
  initialTab?: TabId
}

type TabId = 'items' | 'summary' | 'settings'
const TABS: TabId[] = ['items', 'summary', 'settings']
const TAB_LABELS: Record<TabId, string> = {
  items: 'Items',
  settings: 'Settings',
  summary: 'Summary',
}

const TAB_LIST = 'flex gap-1 border-b border-border mb-4'
const tabBtnClass = (active: boolean): string =>
  'px-4 py-2 text-[0.85rem] font-semibold border-b-2 -mb-px bg-transparent cursor-pointer ' +
  (active ? 'border-accent text-text-base' : 'border-transparent text-text-muted hover:text-text-base')

const statusLabel = function statusLabel(source: FeedbackSource): string {
  if (Predicate.isNotNullish(source.revokedAt)) {
    return 'Revoked'
  }
  return source.isActive ? 'Active' : 'Inactive'
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const FeedbackSourceHeader = function FeedbackSourceHeader({
  source,
  sources,
  projectId,
  workspaceSlug,
}: {
  source: FeedbackSource
  sources: Readonly<FeedbackSource[]>
  projectId: string
  workspaceSlug: string
}): JSX.Element {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
      <div className='flex items-center gap-2'>
        <h1 className='text-xl font-bold text-text-base m-0'>{source.name}</h1>
        <span className='text-[0.7rem] font-medium px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted'>
          {statusLabel(source)}
        </span>
      </div>
      {hasMultipleItems(sources) && (
        <Select
          ariaLabel='Switch feedback source'
          value={source.id}
          onChange={(id) => {
            navigateFeature(
              `/feedback/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}&workspace=${encodeURIComponent(workspaceSlug)}`,
            )
          }}
          options={sources.map(({ id, name }) => ({ label: name, value: id }))}
        />
      )}
    </div>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const FeedbackTabPanels = function FeedbackTabPanels({
  tab,
  workspaceSlug,
  projectId,
  source,
  initialRows,
  initialSummary,
  initialStatus,
}: {
  tab: TabId
  workspaceSlug?: string
  projectId: string
  source: FeedbackSource
  initialRows: Readonly<Feedback[]>
  initialSummary: SourceSummary | null
  initialStatus?: string
}): JSX.Element {
  return (
    <>
      {tab === 'items' && (
        <div role='tabpanel' id='feedback-tabpanel-items' aria-labelledby='feedback-tab-items'>
          <FeedbackList
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            sourceId={source.id}
            initialRows={initialRows}
            initialStatus={initialStatus}
          />
        </div>
      )}
      {tab === 'summary' && (
        <div role='tabpanel' id='feedback-tabpanel-summary' aria-labelledby='feedback-tab-summary'>
          <FeedbackSummary
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            sourceId={source.id}
            initialSummary={initialSummary}
          />
        </div>
      )}
      {tab === 'settings' && (
        <div role='tabpanel' id='feedback-tabpanel-settings' aria-labelledby='feedback-tab-settings'>
          <FeedbackSourceSettings source={source} projectId={projectId} workspaceSlug={workspaceSlug} />
        </div>
      )}
    </>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const FeedbackTabBar = function FeedbackTabBar({
  tab,
  tabRefs,
  onTabKeyDown,
  hrefForTab,
}: {
  tab: TabId
  tabRefs: { current: Partial<Record<TabId, HTMLAnchorElement | null>> }
  onTabKeyDown: (selectedEvent: React.KeyboardEvent<HTMLDivElement>) => void
  hrefForTab: (id: TabId) => string
}): JSX.Element {
  return (
    <div role='tablist' aria-label='Feedback source' className={TAB_LIST} onKeyDown={onTabKeyDown}>
      {TABS.map((id) => (
        <a
          key={id}
          ref={(el) => {
            tabRefs.current[id] = el
          }}
          href={hrefForTab(id)}
          role='tab'
          id={`feedback-tab-${id}`}
          aria-selected={tab === id}
          aria-controls={`feedback-tabpanel-${id}`}
          tabIndex={tab === id ? 0 : -1}
          className={tabBtnClass(tab === id)}
        >
          {TAB_LABELS[id]}
        </a>
      ))}
    </div>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function FeedbackSourceDetail({
  workspaceSlug,
  projectId,
  initialSource,
  initialSources,
  initialRows,
  initialSummary,
  initialStatus,
  initialTab = 'items',
}: FeedbackDetailProps): JSX.Element {
  const sourceId = initialSource.id
  const sources = initialSources
  const tab = initialTab
  const tabRefs = useRef<Partial<Record<TabId, HTMLAnchorElement | null>>>({})
  const hrefForTab = function hrefForTab(id: TabId): string {
    const params = new URLSearchParams({ projectId, workspace: workspaceSlug, tab: id })
    if (Predicate.isNotNullish(initialStatus) && String.isNonEmpty(initialStatus)) {
      params.set('status', initialStatus)
    }
    return `/feedback/${encodeURIComponent(sourceId)}?${params}`
  }

  const focusTab = function focusTab(id: TabId): void {
    tabRefs.current[id]?.focus()
  }

  const onTabKeyDown = function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const focused = TABS.find((id) => tabRefs.current[id] === document.activeElement) ?? tab
    const idx = TABS.indexOf(focused)
    let nextId: TabId | null = null
    if (event.key === 'ArrowRight') {
      nextId = TABS[(idx + 1) % TABS.length]
    } else if (event.key === 'ArrowLeft') {
      nextId = TABS[(idx - 1 + TABS.length) % TABS.length]
    } else if (event.key === 'Home') {
      nextId = TABS[0]
    } else if (event.key === 'End') {
      nextId = TABS[TABS.length - 1]
    }
    if (!nextId) {
      return
    }
    event.preventDefault()
    focusTab(nextId)
    navigateFeature(hrefForTab(nextId))
  }

  const source = sources.find((selectedSource) => selectedSource.id === sourceId)
  if (!source) {
    return (
      <div className='p-6 text-center text-text-muted bg-surface rounded-lg border border-border'>
        Feedback source not found.
      </div>
    )
  }

  return (
    <div>
      <FeedbackSourceHeader source={source} sources={sources} projectId={projectId} workspaceSlug={workspaceSlug} />

      <FeedbackTabBar tab={tab} tabRefs={tabRefs} onTabKeyDown={onTabKeyDown} hrefForTab={hrefForTab} />

      <FeedbackTabPanels
        tab={tab}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        source={source}
        initialRows={initialRows}
        initialSummary={initialSummary}
        initialStatus={initialStatus}
      />
    </div>
  )
}
