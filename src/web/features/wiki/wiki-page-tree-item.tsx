'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { WIKI_PAGE_LIST_ITEM_CLASS } from './wiki-page-list-style.ts'
import type { TreeNode } from './wiki-page-model.ts'

const TREE_BASE_PADDING_REM = 0.5

const TREE_PADDING_PER_LEVEL_REM = 1

const ROOT_TREE_DEPTH = 0

const CHILD_DEPTH_STEP = 1

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function TreeNodeItem({
  node,
  currentSlug,
  depth,
  onNavigate,
}: {
  node: TreeNode
  currentSlug: string
  depth: number
  onNavigate: (slug: string) => void
}): JSX.Element {
  const isActive = currentSlug === node.slug
  return (
    <li>
      <button
        type='button'
        className={`${WIKI_PAGE_LIST_ITEM_CLASS} ${isActive ? '!bg-accent !text-white font-semibold' : ''}`}
        style={{ paddingLeft: `${TREE_BASE_PADDING_REM + depth * TREE_PADDING_PER_LEVEL_REM}rem` }}
        onClick={() => {
          onNavigate(node.slug)
        }}
        aria-current={isActive ? 'page' : undefined}
      >
        {depth > ROOT_TREE_DEPTH && <span className='text-text-muted mr-1'>{'›'}</span>}
        {node.title}
      </button>
      {Array.isArrayNonEmpty(node.children) && (
        <ul className='list-none m-0 p-0'>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              currentSlug={currentSlug}
              depth={depth + CHILD_DEPTH_STEP}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
