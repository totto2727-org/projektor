'use client'

import { Predicate } from 'effect'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

import type { DraftStatus, ServerDraft, WikiPageData } from './wiki-page-model.ts'

const DRAFT_AUTOSAVE_DELAY_MS = 1000

/*
 * PROJ-495 (R13): server-side per-user draft autosave, replacing the PROJ-227
 * localStorage version so an in-progress edit survives a device switch, not just a
 * same-browser crash. Same ~1s debounce cadence as before; debouncing stays entirely
 * client-side (no server-side throttling) so this is just a plain PUT on a timer.
 *
 * PROJ-799: a draft is only written when the edit actually differs from the
 * published page (so opening and cancelling never leaves a spurious "Restore unsaved
 * draft?" behind), and reverting to the published text deletes the draft this
 * session wrote. Autosave is paused while a save is in flight, and stays off until
 * the existing server draft has been checked — if that check fails, autosave is
 * disabled for the session rather than risk overwriting a draft from another device.
 */
export interface DraftAutosaveOptions {
  workspaceSlug: string | undefined
  editing: boolean
  editTitle: string
  editContent: string
  page: WikiPageData | null
  draftBanner: ServerDraft | null
  baseRevisionId: string | null | undefined
  saving: boolean
  draftStatus: DraftStatus
}

export const differsFromPublished = function differsFromPublished(
  page: Readonly<{ title: string; content: string }>,
  title: string,
  content: string,
): boolean {
  return title !== page.title || content !== page.content
}

const pageForDraftWrite = function pageForDraftWrite(options: DraftAutosaveOptions): WikiPageData | undefined {
  return options.page && !options.draftBanner && options.draftStatus === 'ready' ? options.page : undefined
}

export interface DraftSnapshot {
  page: WikiPageData
  title: string
  content: string
  base: string | null | undefined
}

type PersistDraft = (snapshot: DraftSnapshot) => void

const persistWritableDraft = function persistWritableDraft(
  options: DraftAutosaveOptions,
  persistDraft: PersistDraft,
): void {
  const page = pageForDraftWrite(options)
  if (Predicate.isNullish(page)) {
    return
  }
  persistDraft({ base: options.baseRevisionId, content: options.editContent, page, title: options.editTitle })
}

const useDebouncedDraftWrite = function useDebouncedDraftWrite(
  options: DraftAutosaveOptions,
  persistDraft: PersistDraft,
): void {
  const { editing, editTitle, editContent, page, draftBanner, baseRevisionId, saving, draftStatus } = options
  useEffect(() => {
    const timer =
      editing && page && !draftBanner && !saving && draftStatus === 'ready'
        ? setTimeout(() => {
            persistDraft({ base: baseRevisionId, content: editContent, page, title: editTitle })
          }, DRAFT_AUTOSAVE_DELAY_MS)
        : undefined
    return () => {
      if (Predicate.isNotNullish(timer)) {
        clearTimeout(timer)
      }
    }
  }, [editing, editTitle, editContent, page, draftBanner, baseRevisionId, saving, draftStatus, persistDraft])
}

export const useDraftAutosaveLifecycle = function useDraftAutosaveLifecycle(
  options: DraftAutosaveOptions,
  persistDraft: PersistDraft,
): { flushDraftNow: () => void; skipLeaveFlushRef: RefObject<boolean> } {
  const { editing } = options
  const latestDraftStateRef = useRef(options)
  useLayoutEffect(() => {
    latestDraftStateRef.current = options
  }, [options])

  // Successful publication or discard clears the draft itself, so a leave must not recreate it.
  const skipLeaveFlushRef = useRef(false)
  useDebouncedDraftWrite(options, persistDraft)

  // Flush pending edits on navigation so leaving before the debounce expires keeps the draft.
  useEffect(
    () => () => {
      if (!editing) {
        return
      }
      if (skipLeaveFlushRef.current) {
        skipLeaveFlushRef.current = false
        return
      }
      persistWritableDraft(latestDraftStateRef.current, persistDraft)
    },
    [editing, persistDraft],
  )

  // Navigation can clear the current page before cleanup. Flush it first and skip that cleanup.
  const flushDraftNow = function flushDraftNow(): void {
    const draftState = latestDraftStateRef.current
    if (!draftState.editing) {
      return
    }
    skipLeaveFlushRef.current = true
    persistWritableDraft(draftState, persistDraft)
  }

  return { flushDraftNow, skipLeaveFlushRef }
}
