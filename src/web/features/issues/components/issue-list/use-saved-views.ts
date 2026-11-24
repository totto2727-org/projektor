'use client'
import { Schema } from 'effect'
import { useEffect, useState } from 'react'

import {
  captureView,
  filtersMatch,
  parseSavedViews,
  removeView,
  upsertView,
  viewsStorageKey,
} from '@/features/issues/components/saved-views.ts'
import type { SavedView, SavedViewFilters } from '@/features/issues/components/saved-views.ts'
import { RequiredText, useIssueForm } from '@/features/issues/forms.ts'

/** Named entity-bearing filters remain per-tab and scoped to the authenticated identity. */
export const useSavedViews = function useSavedViews(
  filterProject: string,
  currentFilters: SavedViewFilters,
  onApply: (filters: SavedViewFilters) => void,
  workspaceSlug: string,
  userId: string,
) {
  const storageKey = viewsStorageKey(`${userId}:${workspaceSlug}:${filterProject}`)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [activeViewName, setActiveViewName] = useState<string | null>(null)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const nameForm = useIssueForm({ name: '' }, Schema.Struct({ name: RequiredText }))
  const [saveViewName, setSaveViewName] = nameForm.field('name')
  useEffect(() => {
    try {
      setSavedViews(parseSavedViews(sessionStorage.getItem(storageKey)))
    } catch {
      setSavedViews([])
    }
    setActiveViewName(null)
  }, [storageKey])
  useEffect(() => {
    if (!activeViewName) {
      return
    }
    const active = savedViews.find((view) => view.name === activeViewName)
    if (!active || !filtersMatch(currentFilters, active.filters)) {
      setActiveViewName(null)
    }
  }, [currentFilters, activeViewName, savedViews])
  const persist = function persist(updated: SavedView[]): void {
    setSavedViews(updated)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(updated))
    } catch {
      /* Storage is optional, controls still work in memory. */
    }
  }
  const doSaveView = async function doSaveView(): Promise<void> {
    if (!(await nameForm.validate())) {
      return
    }
    const name = saveViewName.trim()
    persist(upsertView(savedViews, captureView(name, currentFilters)))
    setActiveViewName(name)
    setSaveViewName('')
    setShowSaveInput(false)
  }
  const deleteView = function deleteView(name: string): void {
    persist(removeView(savedViews, name))
    if (activeViewName === name) {
      setActiveViewName(null)
    }
  }
  const applyView = function applyView(view: SavedView): void {
    onApply(view.filters)
    setActiveViewName(view.name)
  }
  return {
    savedViews,
    activeViewName,
    showSaveInput,
    setShowSaveInput,
    saveViewName,
    setSaveViewName,
    doSaveView,
    deleteView,
    applyView,
  }
}
