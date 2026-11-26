'use client'

import { Predicate } from 'effect'
import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'

import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { Published } from '#contracts/web-schemas/wiki.ts'
import { unwrapResult } from '@/client/functions.ts'

import { discardWikiDraft, saveWikiDraft, saveWikiPage } from './actions.ts'
import { differsFromPublished, useDraftAutosaveLifecycle } from './wiki-draft-lifecycle.ts'
import type { DraftAutosaveOptions, DraftSnapshot } from './wiki-draft-lifecycle.ts'
import type { ServerDraft, WikiPageData } from './wiki-page-model.ts'
import { useWikiSeed } from './wiki-seed-context.ts'

type PublishedPage = (typeof Published)['Type']

const saveWikiPageEdit = async function saveWikiPageEdit(
  params: Readonly<{
    workspaceSlug: string | undefined
    page: WikiPageData
    editTitle: string
    editContent: string
    baseRevisionId: string | null | undefined
    expectedDraftRevision: string | null
  }>,
): Promise<PublishedPage> {
  const { workspaceSlug, page, editTitle, editContent, baseRevisionId, expectedDraftRevision } = params
  return unwrapResult(
    await saveWikiPage(
      fieldsInOrder([
        ['workspaceSlug', workspaceSlug],
        ['slug', page.slug],
        ['title', editTitle],
        ['content', editContent],
        ['baseRevisionId', baseRevisionId],
        ['expectedDraftRevision', expectedDraftRevision],
      ]),
    ),
  )
}

interface ServerDraftAutosave {
  skipLeaveFlushRef: RefObject<boolean>
  serverHasDraftRef: RefObject<boolean>
  flushDraftNow: () => void
  adoptDraftState: (state: { revision: string | null; draft: ServerDraft | null }) => void
  discardDraftNow: (page: WikiPageData, title: string, content: string) => Promise<void>
  publishDraft: (snapshot: DraftSnapshot) => Promise<PublishedPage>
  writeWarning: string | undefined
  needsReconciliation: () => boolean
}

export const useServerDraftAutosave = function useServerDraftAutosave(
  options: DraftAutosaveOptions,
): ServerDraftAutosave {
  const { workspaceSlug } = options
  /*
   * PROJ-799: whether a server draft for this page is known to exist (this session
   * wrote one, or the user restored the one found on open). Only then does reverting
   * to the published text issue a DELETE — never for a draft this session hasn't seen.
   */
  const seed = useWikiSeed()
  const serverHasDraftRef = useRef(seed.mode === 'edit' && Boolean(seed.draft))
  const revisionRef = useRef(seed.draftRevision ?? JSON_NULL)
  const lastPersistedRef = useRef('')
  const tailRef = useRef<Promise<unknown>>(Promise.resolve())
  const emptyQueue = 'empty'
  const pendingRef = useRef<DraftSnapshot | typeof emptyQueue>(emptyQueue)
  const drainingRef = useRef(false)
  const blockedRef = useRef(false)
  const suspendedRef = useRef(false)
  const [writeWarning, setWriteWarning] = useState<string>()

  /*
   * One page-local chain orders autosave, explicit discard and publication. Only
   * its pending snapshot is replaceable, so typing B/C while A saves writes C next.
   */
  const drainDrafts = useCallback(() => {
    if (drainingRef.current) {
      return
    }
    drainingRef.current = true
    const task = tailRef.current
      .then(async () => {
        while (pendingRef.current !== emptyQueue && !suspendedRef.current && !blockedRef.current) {
          const { page: draftPage, title, content, base } = pendingRef.current
          pendingRef.current = emptyQueue
          const fingerprint = JSON.stringify([draftPage.id, title, content, base ?? JSON_NULL])
          if (lastPersistedRef.current === fingerprint) {
            continue
          }
          try {
            if (differsFromPublished(draftPage, title, content)) {
              const result = unwrapResult(
                await saveWikiDraft(
                  fieldsInOrder([
                    ['workspaceSlug', workspaceSlug],
                    ['slug', draftPage.slug],
                    ['title', title],
                    ['content', content],
                    ['baseRevisionId', base ?? JSON_NULL],
                    ['expectedDraftRevision', revisionRef.current],
                  ]),
                ),
              )
              revisionRef.current = result.revision
              serverHasDraftRef.current = true
            } else if (serverHasDraftRef.current) {
              const result = unwrapResult(
                await discardWikiDraft(
                  fieldsInOrder([
                    ['workspaceSlug', workspaceSlug],
                    ['slug', draftPage.slug],
                    ['expectedDraftRevision', revisionRef.current],
                  ]),
                ),
              )
              revisionRef.current = result.revision
              serverHasDraftRef.current = false
            }
            // Failed or unacknowledged writes never mark a fingerprint persisted.
            lastPersistedRef.current = fingerprint
            setWriteWarning(undefined)
          } catch {
            blockedRef.current = true
            setWriteWarning('Autosave did not complete. Your text is still here. Save before leaving this page.')
            pendingRef.current = emptyQueue
            break
          }
        }
      })
      .finally(() => {
        drainingRef.current = false
      })
    tailRef.current = task.catch(() => {})
  }, [workspaceSlug])

  const persistDraft = useCallback(
    (snapshot: DraftSnapshot): void => {
      pendingRef.current = snapshot
      drainDrafts()
    },
    [drainDrafts],
  )

  const adoptDraftState = function adoptDraftState(state: {
    revision: string | null
    draft: ServerDraft | null
  }): void {
    revisionRef.current = state.revision
    blockedRef.current = false
    serverHasDraftRef.current = Predicate.isNotNullish(state.draft)
    lastPersistedRef.current = ''
    setWriteWarning(undefined)
  }

  const discardDraftNow = function discardDraftNow(
    draftPage: WikiPageData,
    title: string,
    content: string,
  ): Promise<void> {
    suspendedRef.current = true
    pendingRef.current = emptyQueue
    const task = tailRef.current
      .then(async () => {
        const result = unwrapResult(
          await discardWikiDraft(
            fieldsInOrder([
              ['workspaceSlug', workspaceSlug],
              ['slug', draftPage.slug],
              ['expectedDraftRevision', revisionRef.current],
            ]),
          ),
        )
        revisionRef.current = result.revision
        serverHasDraftRef.current = false
        lastPersistedRef.current = ''
        if (
          pendingRef.current !== emptyQueue &&
          pendingRef.current.title === title &&
          pendingRef.current.content === content
        ) {
          pendingRef.current = emptyQueue
        }
      })
      .catch((error: unknown) => {
        blockedRef.current = true
        pendingRef.current = emptyQueue
        throw error
      })
      .finally(() => {
        suspendedRef.current = false
        if (pendingRef.current !== emptyQueue) {
          drainDrafts()
        }
      })
    tailRef.current = task.catch(() => {})
    return task
  }

  const publishDraft = function publishDraft(snapshot: DraftSnapshot): Promise<PublishedPage> {
    suspendedRef.current = true
    pendingRef.current = emptyQueue
    const task = tailRef.current
      .then(async () => {
        const result = await saveWikiPageEdit(
          fieldsInOrder([
            ['workspaceSlug', workspaceSlug],
            ['page', snapshot.page],
            ['editTitle', snapshot.title],
            ['editContent', snapshot.content],
            ['baseRevisionId', snapshot.base],
            ['expectedDraftRevision', revisionRef.current],
          ]),
        )
        if (Predicate.isNullish(result.draftRevision)) {
          blockedRef.current = true
          pendingRef.current = emptyQueue
          setWriteWarning(
            'The page was published, but its saved draft changed. Reopen editing to reconcile it before autosaving.',
          )
        } else {
          revisionRef.current = result.draftRevision
          serverHasDraftRef.current = false
          lastPersistedRef.current = ''
        }
        if (
          pendingRef.current !== emptyQueue &&
          pendingRef.current.title === snapshot.title &&
          pendingRef.current.content === snapshot.content
        ) {
          pendingRef.current = emptyQueue
        }
        return result
      })
      .catch((error: unknown) => {
        blockedRef.current = true
        pendingRef.current = emptyQueue
        throw error
      })
      .finally(() => {
        suspendedRef.current = false
        if (pendingRef.current !== emptyQueue) {
          drainDrafts()
        }
      })
    tailRef.current = task.catch(() => {})
    return task
  }

  const { flushDraftNow, skipLeaveFlushRef } = useDraftAutosaveLifecycle(options, persistDraft)
  return {
    adoptDraftState,
    discardDraftNow,
    flushDraftNow,
    needsReconciliation: (): boolean => blockedRef.current,
    publishDraft,
    serverHasDraftRef,
    skipLeaveFlushRef,
    writeWarning,
  }
}
