'use client'

import type { JSX } from 'react'

/*
 * PROJ-489 (R7): computed/derived at read time, never stored — null when the page has
 * no verify_interval/status frontmatter signal at all.
 */
export interface WikiFreshness {
  state: 'fresh' | 'stale' | 'unverified'
  staleSince: number | null
}

/*
 * PROJ-489 (R7): "fresh" renders nothing — only stale/unverified pages need a visual
 * nudge; a page with no freshness signal at all (`null`) also renders nothing (handled
 * by the caller, not this component).
 */
const WIKI_FRESHNESS_BADGE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  stale: { bg: 'var(--priority-high-bg)', color: 'var(--priority-high-text)', label: 'Stale' },
  unverified: {
    bg: 'var(--priority-low-bg)',
    color: 'var(--priority-low-text)',
    label: 'Unverified',
  },
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiFreshnessBadge({ state }: { state: WikiFreshness['state'] }): undefined | JSX.Element {
  const style = WIKI_FRESHNESS_BADGE_STYLE[state]
  if (!style) {
    return undefined
  }
  return (
    <span
      className='inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold uppercase tracking-wide'
      style={{ background: style.bg, color: style.color }}
    >
      {style.label}
    </span>
  )
}
