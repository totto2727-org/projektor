'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { formatTimestampDate } from '@/features/timestamp.ts'

import { TagChips } from './tag-chips.tsx'
import { WikiFreshnessBadge } from './wiki-freshness-badge.tsx'
import type { WikiPageData } from './wiki-page-client.tsx'
import { WikiStatusPill } from './wiki-status-pill.tsx'

/*
 * PROJ-488: header card summarizing a page's frontmatter metadata (type/status/tags/
 * owners/verification). Omitted entirely for a page with no frontmatter at all, so
 * pages predating this feature (or that simply don't use it) render exactly as before.
 *
 * PROJ-489 (R7): the Verify button/freshness badge only render when the page has opted
 * into verification tracking (a verify_interval or a status set) — a page with neither
 * has freshness: null and nothing meaningful to verify against.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiMetadataBadges({ page }: { page: WikiPageData }): JSX.Element {
  return (
    <>
      {page.type && (
        <span
          className={
            'inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold ' +
            'uppercase tracking-wide bg-bg border border-border text-text-muted'
          }
        >
          {page.type}
        </span>
      )}
      {page.status && <WikiStatusPill status={page.status} />}
      {page.freshness && page.freshness.state !== 'fresh' && <WikiFreshnessBadge state={page.freshness.state} />}
      <TagChips tags={page.tags} />
      {Array.isArrayNonEmpty(page.owners) && <span>Owners: {page.owners.join(', ')}</span>}
      {page.verified_at && (
        <span>
          Verified {formatTimestampDate(page.verified_at)}
          {page.verified_by ? ` by ${page.verified_by}` : ''}
        </span>
      )}
    </>
  )
}
