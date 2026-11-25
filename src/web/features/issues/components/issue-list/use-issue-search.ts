'use client'
import { String, Schema } from 'effect'
import { useEffect, useRef } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

import type { ReviewTarget } from '#contracts/review-targets.ts'
import { Text, useIssueForm } from '@/features/issues/forms.ts'
import type { IssuesRoute } from '@/features/issues/views/issues-page.tsx'
export interface SearchResult {
  id: string
  number: number
  title: string
  status: string
  priority: string
  project_id: string | null
  project_key: string | null
  project_name: string | null
  workspaceSlug?: string
  reviewTargets: Readonly<ReviewTarget[]>
}
export interface IssueSearchSeed {
  query: string
  results: SearchResult[] | null
}

interface IssueSearch {
  isSearchActive: boolean
  resultQuery: string
  route: IssuesRoute
  searchInputRef: RefObject<HTMLInputElement | null>
  searchQuery: string
  searchResults: SearchResult[] | null
  setSearchQuery: Dispatch<SetStateAction<string>>
}

/**
 * Only the editable query is local. Search results and identity come from canonical SSR props.
 *
 * @param {IssueSearchSeed} seed The current server-rendered query and results.
 * @param {IssuesRoute} route Route used by the search controls.
 * @returns {IssueSearch} The editable query, input ref and current server-rendered results.
 */
export const useIssueSearch = function useIssueSearch(seed: IssueSearchSeed, route: IssuesRoute): IssueSearch {
  const searchForm = useIssueForm({ query: seed.query }, Schema.Struct({ query: Text }))
  const [searchQuery, setSearchQuery] = searchForm.field('query')
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searchQuery === seed.query) {
      return
    }
    const timer = setTimeout(() => searchInputRef.current?.form?.requestSubmit(), 300)
    return () => {
      clearTimeout(timer)
    }
  }, [searchQuery, seed.query])
  return {
    searchQuery,
    setSearchQuery,
    resultQuery: seed.query,
    searchResults: seed.results,
    searchInputRef,
    isSearchActive: String.isNonEmpty(seed.query.trim()),
    route,
  }
}
