'use client'
import { Schema } from 'effect'
import { useEffect, useState } from 'react'

import { RequiredText, useIssueForm } from '../../forms'
import {
  captureView,
  filtersMatch,
  parseSavedViews,
  removeView,
  type SavedView,
  type SavedViewFilters,
  upsertView,
  viewsStorageKey,
} from '../saved-views'

/** Named entity-bearing filters remain per-tab and scoped to the authenticated identity. */
export function useSavedViews(
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
    if (!activeViewName) return
    const active = savedViews.find((view) => view.name === activeViewName)
    if (!active || !filtersMatch(currentFilters, active.filters)) setActiveViewName(null)
  }, [currentFilters, activeViewName, savedViews])
  function persist(updated: SavedView[]) {
    setSavedViews(updated)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(updated))
    } catch {
      /* Storage is optional, controls still work in memory. */
    }
  }
  async function doSaveView() {
    if (!(await nameForm.validate())) return
    const name = saveViewName.trim()
    persist(upsertView(savedViews, captureView(name, currentFilters)))
    setActiveViewName(name)
    setSaveViewName('')
    setShowSaveInput(false)
  }
  function deleteView(name: string) {
    persist(removeView(savedViews, name))
    if (activeViewName === name) setActiveViewName(null)
  }
  function applyView(view: SavedView) {
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
