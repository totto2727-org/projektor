'use client'

import { Array, Function, Predicate } from 'effect'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

/** Matches Base.astro's mobile breakpoint. */
const WIKI_MOBILE_QUERY = '(max-width: 640px)'
const WIKI_DESKTOP_QUERY = '(min-width: 641px)'
const DRAWER_FOCUSABLES = 'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
const LAST_ITEM_OFFSET = 1

/*
 * PROJ-664: the Wiki reader switches whole layout sections when the viewport
 * crosses the breakpoint.
 */
export const useIsMobileViewport = function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (!Predicate.isFunction(globalThis.matchMedia)) {
      return Function.constVoid
    }
    const mediaQuery = globalThis.matchMedia(WIKI_MOBILE_QUERY)
    setIsMobile(mediaQuery.matches)
    const onChange = (event: MediaQueryListEvent): void => {
      setIsMobile(event.matches)
    }
    mediaQuery.addEventListener('change', onChange)
    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [])
  return isMobile
}

const watchDrawerDismissal = function watchDrawerDismissal(close: () => void): () => void {
  const onKeyDown = function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close()
    }
  }
  document.addEventListener('keydown', onKeyDown)
  const desktopQuery = globalThis.matchMedia(WIKI_DESKTOP_QUERY)
  const onGrow = (event: MediaQueryListEvent): void => {
    if (event.matches) {
      close()
    }
  }
  desktopQuery.addEventListener('change', onGrow)
  return () => {
    document.removeEventListener('keydown', onKeyDown)
    desktopQuery.removeEventListener('change', onGrow)
  }
}

const keepFocusInside = function keepFocusInside(event: KeyboardEvent, container: HTMLElement): void {
  const focusables = globalThis.Array.from(container.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLES)).filter(
    (element) => !element.hasAttribute('disabled'),
  )
  if (Array.isArrayEmpty(focusables)) {
    return
  }
  const [first] = focusables
  const last = focusables[focusables.length - LAST_ITEM_OFFSET]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

const watchDrawerTab = function watchDrawerTab(sidebarRef: RefObject<HTMLElement | null>): () => void {
  const onTrapTab = function onTrapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !globalThis.matchMedia(WIKI_MOBILE_QUERY).matches) {
      return
    }
    const container = sidebarRef.current
    if (container) {
      keepFocusInside(event, container)
    }
  }
  document.addEventListener('keydown', onTrapTab)
  return () => {
    document.removeEventListener('keydown', onTrapTab)
  }
}

interface WikiSidebarDrawer {
  close: () => void
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  sidebarRef: RefObject<HTMLElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
}

/**
 * Keeps focus in the page-tree drawer while it is open on mobile.
 *
 * @returns {WikiSidebarDrawer} Drawer state, controls and element refs.
 */
export const useWikiSidebarDrawer = function useWikiSidebarDrawer(): WikiSidebarDrawer {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  useEffect(() => (open ? watchDrawerDismissal(close) : undefined), [open, close])

  // PROJ-806: only open/close transitions move focus. The first render leaves the user's focus in place.
  const isFirstRenderRef = useRef(true)
  useEffect(() => {
    const isFirstRender = isFirstRenderRef.current
    isFirstRenderRef.current = false
    if (isFirstRender || !globalThis.matchMedia(WIKI_MOBILE_QUERY).matches) {
      return
    }
    if (open) {
      sidebarRef.current?.querySelector<HTMLElement>(DRAWER_FOCUSABLES)?.focus()
    } else {
      triggerRef.current?.focus()
    }
  }, [open])

  useEffect(() => (open ? watchDrawerTab(sidebarRef) : undefined), [open])

  return { close, open, setOpen, sidebarRef, triggerRef }
}
