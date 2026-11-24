'use client'
import { Predicate } from 'effect'
import { useEffect, useState } from 'react'
/** Null preserves both CSS-controlled layouts in SSR and the hydration snapshot. */
export const useMediaQuery = function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null)
  useEffect(() => {
    if (!Predicate.isFunction(window.matchMedia)) {
      setMatches(false)
      return
    }
    const mql = window.matchMedia(query)
    const onChange = (): void => {
      setMatches(mql.matches)
    }
    onChange()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}
