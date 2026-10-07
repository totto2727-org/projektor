'use client'
import { Schema } from 'effect'
import { useEffect, useRef } from 'react'

import { Text, useIssueForm } from '../../forms'
import type { IssuesRoute } from '../../views/IssuesPage'
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
}
export interface IssueSearchSeed {
  query: string
  results: SearchResult[] | null
}

/** Only the editable query is local. Search results and identity come from canonical SSR props. */
export function useIssueSearch(seed: IssueSearchSeed, route: IssuesRoute) {
  const searchForm = useIssueForm({ query: seed.query }, Schema.Struct({ query: Text }))
  const [searchQuery, setSearchQuery] = searchForm.field('query')
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searchQuery === seed.query) return
    const timer = setTimeout(() => searchInputRef.current?.form?.requestSubmit(), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, seed.query])
  return {
    searchQuery,
    setSearchQuery,
    resultQuery: seed.query,
    searchResults: seed.results,
    searchInputRef,
    isSearchActive: seed.query.trim().length > 0,
    route,
  }
}
