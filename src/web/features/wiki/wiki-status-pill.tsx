'use client'

import type { JSX } from 'react'

const WIKI_STATUS_PILL_STYLE: Record<string, { bg: string; color: string }> = {
  draft: { bg: 'var(--priority-low-bg)', color: 'var(--priority-low-text)' },
  current: { bg: 'var(--status-done-bg)', color: 'var(--status-done)' },
  stale: { bg: 'var(--priority-high-bg)', color: 'var(--priority-high-text)' },
  deprecated: { bg: 'var(--danger-bg)', color: 'var(--danger-text)' },
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiStatusPill({ status }: { status: string }): JSX.Element {
  const style = WIKI_STATUS_PILL_STYLE[status] ?? {
    bg: 'var(--priority-low-bg)',
    color: 'var(--priority-low-text)',
  }
  return (
    <span
      className='inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold uppercase tracking-wide'
      style={{ background: style.bg, color: style.color }}
    >
      {status}
    </span>
  )
}
