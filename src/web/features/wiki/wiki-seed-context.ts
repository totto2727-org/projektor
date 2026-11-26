'use client'

import { createContext, useContext } from 'react'

import type { WikiSeed } from './wiki-page-model.ts'

export const SeedContext = createContext<WikiSeed | undefined>(undefined)
export const useWikiSeed = function useWikiSeed(): WikiSeed {
  const seed = useContext(SeedContext)
  if (!seed) {
    throw new Error('Wiki server DTO is required.')
  }
  return seed
}
export const usePublicViewer = function usePublicViewer(_workspaceSlug?: string): boolean {
  return useWikiSeed().publicViewer
}
