'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import type { TreeNode } from './wiki-page-model.ts'
import { TreeNodeItem } from './wiki-page-tree-item.tsx'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function PageTreeList({
  loading,
  tree,
  slug,
  onNavigate,
}: {
  loading: boolean
  tree: TreeNode[]
  slug: string
  onNavigate: (slug: string) => void
}): JSX.Element {
  if (loading) {
    return <p className='text-[0.8rem] text-text-muted m-0'>Loading…</p>
  }
  return (
    <ul className='list-none m-0 p-0'>
      {tree.map((node) => (
        <TreeNodeItem key={node.id} node={node} currentSlug={slug} depth={0} onNavigate={onNavigate} />
      ))}
      {Array.isArrayEmpty(tree) && <li className='text-[0.8rem] text-text-muted'>No pages yet</li>}
    </ul>
  )
}
