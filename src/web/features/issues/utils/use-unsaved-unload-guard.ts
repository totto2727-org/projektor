'use client'
import { useEffect } from 'react'
/**
 * Native unload protection. It never patches history or introduces a competing router.
 *
 * @param {boolean} dirty Whether unsaved edits require the native unload prompt.
 */
export const useUnsavedUnloadGuard = function useUnsavedUnloadGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) {
      return
    }
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => {
      window.removeEventListener('beforeunload', guard)
    }
  }, [dirty])
}
