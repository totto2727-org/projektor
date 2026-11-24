'use client'

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

import { ViewErrorBoundary } from '@/components/view-error-boundary.tsx'
import type { RequestScope } from '@/server/request-context.ts'

export { scopedHref } from '@/urls.ts'

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
  if (!runtime) {
    throw new Error('A route RuntimeProvider is required.')
  }
  return runtime
}
