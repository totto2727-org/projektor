'use client'
import { Predicate } from 'effect'
import { useEffect, useState } from 'react'

type MediaQueryResult = Pick<MediaQueryList, 'matches'> &
  Partial<Pick<MediaQueryList, 'addEventListener' | 'removeEventListener'>>

/**
 * Null preserves both CSS-controlled layouts in SSR and the hydration snapshot.
 *
 * @param {string} query The media query observed by the browser.
 * @returns {boolean | null} The current match, or null before the browser has evaluated the query.
 */
export const useMediaQuery = function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null)
  useEffect(() => {
    if (!Predicate.isFunction(window.matchMedia)) {
      setMatches(false)
      return
    }
    const mql: MediaQueryResult = window.matchMedia(query)
    const onChange = (): void => {
      setMatches(mql.matches)
    }
    onChange()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}
