'use client'

import { createContext, type ReactNode, useContext } from 'react'

import { ViewErrorBoundary } from '../components/ViewErrorBoundary'
import type { RequestScope } from '../server/request-context'

export { scopedHref } from '../urls'

export interface RuntimeContext {
  readonly scope: RequestScope | null
  /** Serializable URL supplied by the current Effront Page. */
  readonly url: string
}

const Runtime = createContext<RuntimeContext | null>(null)

/** Display-only request context. Effront owns navigation, refresh and history. */
export function RuntimeProvider({ children, scope, url }: RuntimeContext & { children: ReactNode }) {
  return (
    <Runtime.Provider value={{ scope, url }}>
      <ViewErrorBoundary key={url}>{children}</ViewErrorBoundary>
    </Runtime.Provider>
  )
}

export function useRuntime(): RuntimeContext {
  const runtime = useContext(Runtime)
  if (!runtime) throw new Error('A route RuntimeProvider is required.')
  return runtime
}
