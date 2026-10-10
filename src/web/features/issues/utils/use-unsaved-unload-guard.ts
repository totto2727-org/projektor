'use client'
import { useEffect } from 'react'
/** Native unload protection. It never patches history or introduces a competing router. */
export function useUnsavedUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
}
