'use client'

import { createContext, useContext } from 'react'
import type { JSX, ReactNode } from 'react'

import { ViewErrorBoundary } from '@/components/view-error-boundary.tsx'
import type { RequestScope } from '@/server/request-context.ts'

export { scopedHref } from '@/urls.ts'

export type RuntimeContext = Readonly<{
  scope: RequestScope | null
  /** Serializable URL supplied by the current Effront Page. */
  url: string
}>

const Runtime = createContext<RuntimeContext | null>(null)

/**
 * Display-only request context. Effront owns navigation, refresh and history.
 *
 * @param {RuntimeContext & { children: ReactNode }} props The view content and its server-supplied scope and URL.
 * @returns {JSX.Element} The display context and its error boundary for the current URL.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function RuntimeProvider({ children, scope, url }: RuntimeContext & { children: ReactNode }): JSX.Element {
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
