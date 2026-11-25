'use client'

import { createContext, useContext } from 'react'

import type { WikiSeed } from './wiki-page-client.tsx'

export const SeedContext = createContext<WikiSeed | null>(null)
export function useWikiSeed(): WikiSeed {
  const seed = useContext(SeedContext)
  if (!seed) {
    throw new Error('Wiki server DTO is required.')
  }
  return seed
}
export function usePublicViewer(_workspaceSlug?: string): boolean {
  return useWikiSeed().publicViewer
}
