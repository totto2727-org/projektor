'use client'

import type { JSX } from 'react'

import { FilteredPagesList } from './wiki-filtered-pages.tsx'
import type { SearchResult, TreeNode, WikiListItem } from './wiki-page-model.ts'
import { PageTreeList } from './wiki-page-tree.tsx'
import { SearchResultsList } from './wiki-search-results.tsx'

export const renderWikiPageList = function renderWikiPageList({
  filteredLoading,
  filteredResults,
  hasActiveFilters,
  onNavigate,
  onSelectSearchResult,
  pageTree,
  searchLoading,
  searching,
  searchResults,
  slug,
  treeLoading,
}: {
  filteredLoading: boolean
  filteredResults: WikiListItem[]
  hasActiveFilters: boolean
  onNavigate: (slug: string) => void
  onSelectSearchResult: (slug: string) => void
  pageTree: TreeNode[]
  searchLoading: boolean
  searching: boolean
  searchResults: SearchResult[]
  slug: string
  treeLoading: boolean
}): JSX.Element {
  if (searching) {
    return <SearchResultsList loading={searchLoading} results={searchResults} onSelect={onSelectSearchResult} />
  }
  if (hasActiveFilters) {
    return <FilteredPagesList loading={filteredLoading} results={filteredResults} onSelect={onNavigate} />
  }
  return <PageTreeList loading={treeLoading} tree={pageTree} slug={slug} onNavigate={onNavigate} />
}
