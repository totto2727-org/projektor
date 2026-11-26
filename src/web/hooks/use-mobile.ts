import { useEffect, useState } from 'react'

const MOBILE_BREAKPOINT = 768
const CSS_PIXEL = 1
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - CSS_PIXEL}px)`

export const useIsMobile = function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>()

  useEffect(() => {
    const media = globalThis.matchMedia(MOBILE_QUERY)
    const onChange = function onChange(): void {
      setIsMobile(globalThis.innerWidth < MOBILE_BREAKPOINT)
    }
    media.addEventListener('change', onChange)
    // oxlint-disable-next-line react/set-state-in-effect -- The generated hook asserts the initial viewport after hydration and keeps its first-render value false.
    setIsMobile(globalThis.innerWidth < MOBILE_BREAKPOINT)
    return (): void => {
      media.removeEventListener('change', onChange)
    }
  }, [])

  return isMobile === true
}
