'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

const WIKI_TAG_CHIP_CLASS =
  'inline-flex items-center px-2 py-[0.1rem] mr-1 mb-1 rounded-full text-[0.72rem] ' +
  'bg-bg border border-border text-text-base'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function TagChips({ tags }: { tags: string[] | undefined | null }): undefined | JSX.Element {
  if (!globalThis.Array.isArray(tags) || Array.isArrayEmpty(tags)) {
    return undefined
  }
  return (
    <span className='inline-flex flex-wrap align-middle'>
      {tags.map((tag) => (
        <span key={tag} className={WIKI_TAG_CHIP_CLASS}>
          {tag}
        </span>
      ))}
    </span>
  )
}
