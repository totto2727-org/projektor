'use client'
import { String, Predicate, Schema } from 'effect'
import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

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

interface SavedViews {
  activeViewName: string | undefined
  applyView: (view: SavedView) => void
  deleteView: (name: string) => void
  doSaveView: () => Promise<void>
  saveViewName: string
  savedViews: SavedView[]
  setSaveViewName: Dispatch<SetStateAction<string>>
  setShowSaveInput: Dispatch<SetStateAction<boolean>>
  showSaveInput: boolean
}

/**
 * Named entity-bearing filters remain per-tab and scoped to the authenticated identity.
 *
 * @param {string} filterProject Project key used to select stored views.
 * @param {SavedViewFilters} currentFilters Active filters to compare with or save as a view.
 * @param {(filters: SavedViewFilters) => void} onApply Applies a saved view to the issue filters.
 * @param {string} workspaceSlug Workspace that owns the views.
 * @param {string} userId Authenticated user used to scope the storage key.
 * @returns {SavedViews} Visible views and controls to name, apply or remove them.
 */
export const useSavedViews = function useSavedViews(
  filterProject: string,
  currentFilters: SavedViewFilters,
  onApply: (filters: SavedViewFilters) => void,
  workspaceSlug: string,
  userId: string,
): SavedViews {
  const storageKey = viewsStorageKey(`${userId}:${workspaceSlug}:${filterProject}`)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [activeViewName, setActiveViewName] = useState<string>()
  const [showSaveInput, setShowSaveInput] = useState(false)
  const nameForm = useIssueForm({ name: '' }, Schema.Struct({ name: RequiredText }))
  const [saveViewName, setSaveViewName] = nameForm.field('name')
  useEffect(() => {
    try {
      setSavedViews(parseSavedViews(sessionStorage.getItem(storageKey)))
    } catch {
      setSavedViews([])
    }
    setActiveViewName(undefined)
  }, [storageKey])
  useEffect(() => {
    if (Predicate.isNullish(activeViewName) || String.isEmpty(activeViewName)) {
      return
    }
    const active = savedViews.find((view) => view.name === activeViewName)
    if (!active || !filtersMatch(currentFilters, active.filters)) {
      setActiveViewName(undefined)
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
      setActiveViewName(undefined)
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
