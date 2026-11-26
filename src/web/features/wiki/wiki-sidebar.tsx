'use client'

import { useCallback } from 'react'
import type { JSX, RefObject } from 'react'

import { Button } from '@/components/ui/button.tsx'
import type { SelectOption } from '@/components/ui/select.tsx'

import { WikiFilterBar } from './wiki-filter-bar.tsx'
import { renderWikiPageList } from './wiki-page-list.tsx'
import type { SearchResult, StalePageItem, TreeNode, WikiListItem } from './wiki-page-model.ts'
import { ScopeControl } from './wiki-project-scope.tsx'
import { usePublicViewer, useWikiSeed } from './wiki-seed-context.ts'
import { StalePagesList } from './wiki-stale-pages.tsx'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiSidebar({
  workspaceSlug,
  projectId,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searchLoading,
  treeLoading,
  pageTree,
  slug,
  onNavigate,
  onCreate,
  filterType,
  onFilterTypeChange,
  typeOptions,
  filterStatus,
  onFilterStatusChange,
  filterTags,
  onFilterTagsChange,
  hasActiveFilters,
  filteredResults,
  filteredLoading,
  staleOpen,
  onToggleStale,
  stalePages,
  staleLoading,
  drawerOpen,
  isMobile,
  sidebarRef,
}: {
  workspaceSlug: string | undefined
  projectId: string
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  searchResults: SearchResult[]
  searchLoading: boolean
  treeLoading: boolean
  pageTree: TreeNode[]
  slug: string
  onNavigate: (slug: string) => void
  onCreate: () => void
  filterType: string
  onFilterTypeChange: (type: string) => void
  typeOptions: SelectOption[]
  filterStatus: string
  onFilterStatusChange: (selectedStatus: string) => void
  filterTags: string
  onFilterTagsChange: (tags: string) => void
  hasActiveFilters: boolean
  filteredResults: WikiListItem[]
  filteredLoading: boolean
  staleOpen: boolean
  onToggleStale: (open: boolean) => void
  stalePages: StalePageItem[]
  staleLoading: boolean
  // PROJ-664: below 640px this aside becomes an off-canvas drawer (see
  // WikiPageShell) instead of stacking full-width in flow above the article.
  drawerOpen: boolean
  /*
   * PROJ-806: whether the drawer is acting as a drawer at all (mobile viewport) — on
   * desktop the sidebar is always in normal flow and must never be inert, even though
   * `drawerOpen` itself stays false there (it's only ever opened via the mobile trigger).
   */
  isMobile: boolean
  sidebarRef: RefObject<HTMLElement | null>
}): JSX.Element {
  const asideClass = [
    'w-[240px] shrink-0 bg-surface border-r border-border p-4 overflow-y-auto',
    'wiki-sidebar',
    drawerOpen ? 'wiki-sidebar-open' : '',
  ].join(' ')
  const seed = useWikiSeed()
  const isPublicViewer = usePublicViewer(workspaceSlug)
  const onSelectSearchResult = useCallback(
    (selectedSlug: string): void => {
      onSearchQueryChange('')
      onNavigate(selectedSlug)
    },
    [onNavigate, onSearchQueryChange],
  )
  return (
    <aside
      id='wiki-page-tree'
      className={asideClass}
      aria-label='Wiki pages'
      ref={sidebarRef}
      inert={isMobile && !drawerOpen}
    >
      <ScopeControl workspaceSlug={workspaceSlug} projectId={projectId} />
      {!isPublicViewer && (
        <Button variant='primary' onClick={onCreate} className='w-full mb-4 max-sm:min-h-[44px]'>
          + New page
        </Button>
      )}
      <form method='get' action={seed.slug ? `/wiki/${encodeURIComponent(seed.slug)}` : '/wiki'}>
        <input type='hidden' name='workspace' value={seed.workspaceSlug} />
        {seed.projectId ? (
          <input type='hidden' name='projectId' value={seed.projectId} />
        ) : (
          <input type='hidden' name='scope' value='workspace' />
        )}
        <input
          type='search'
          name='q'
          maxLength={2000}
          value={searchQuery}
          onChange={(event) => {
            onSearchQueryChange(event.target.value)
          }}
          placeholder='Search pages…'
          className='w-full px-3 py-[0.375rem] mb-3 border border-border rounded text-sm bg-bg text-text-base box-border'
          aria-label='Search wiki pages'
        />
        <WikiFilterBar
          filterType={filterType}
          onFilterTypeChange={onFilterTypeChange}
          typeOptions={typeOptions}
          filterStatus={filterStatus}
          onFilterStatusChange={onFilterStatusChange}
          filterTags={filterTags}
          onFilterTagsChange={onFilterTagsChange}
        />
        <Button type='submit' variant='outline' size='sm' className='w-full mb-3'>
          Search / apply filters
        </Button>
      </form>
      {renderWikiPageList({
        filteredLoading,
        filteredResults,
        hasActiveFilters,
        onNavigate,
        onSelectSearchResult,
        pageTree,
        searchLoading,
        searchResults,
        searching: Boolean(seed.searchQuery.trim()),
        slug,
        treeLoading,
      })}
      <details
        className='mt-3 pt-3 border-t border-border'
        open={staleOpen}
        onToggle={(event) => {
          onToggleStale(event.currentTarget.open)
        }}
      >
        <summary className='cursor-pointer text-[0.8rem] text-text-muted select-none'>Needs verification</summary>
        <div className='pt-2'>
          <StalePagesList loading={staleLoading} results={stalePages} onSelect={onNavigate} />
        </div>
      </details>
    </aside>
  )
}
