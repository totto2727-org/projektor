/*
 * PROJ-431: losing a half-typed comment on a phone — backgrounded tab, dropped
 * connection, accidental back — is a real pain point. Drafts are the user's own
 * *unsent* input, which is why they're persisted while fetched issue data deliberately
 * isn't (see the ticket's caching recommendation).
 */

import { Iterable, Predicate } from 'effect'

import { MILLISECONDS_PER_DAY, currentEpochMilliseconds } from '#contracts/time.ts'
const PREFIX = 'projektor:draft:'
const RETENTION_DAYS = 7
const TTL_MS = RETENTION_DAYS * MILLISECONDS_PER_DAY

interface StoredDraft {
  value: string
  at: number
}

/**
 * Build a storage key for one editable field. Scoped by workspace so a draft can never
 * surface under a different tenant.
 *
 * @param {string | undefined} workspaceSlug The workspace containing the edited record.
 * @param {string} scope The entity or editor scope for the field.
 * @param {string} field The editable field name.
 * @returns {string} The session storage key for the draft.
 */
export const draftKey = function draftKey(workspaceSlug: string | undefined, scope: string, field: string): string {
  return `${PREFIX}${workspaceSlug ?? '-'}:${scope}:${field}`
}

/**
 * Returns the stored draft, or null if absent, expired or unreadable.
 *
 * @param {string} key The session storage key for the draft.
 * @returns {string | null} The saved text, or null when storage has no usable draft.
 */
export const loadDraft = function loadDraft(key: string): string | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (Predicate.isNullish(raw)) {
      return null
    }
    const parsed = JSON.parse(raw) as StoredDraft
    if (!Predicate.isString(parsed?.value) || !Predicate.isNumber(parsed?.at)) {
      sessionStorage.removeItem(key)
      return null
    }
    if (currentEpochMilliseconds() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    return parsed.value
  } catch {
    // Unreadable, blocked (private mode) or malformed — behave as if there's no draft.
    return null
  }
}

/**
 * Persists a draft. Empty/whitespace-only values clear the entry rather than storing it.
 *
 * @param {string} key The session storage key for the draft.
 * @param {string} value The current user input.
 */
export const saveDraft = function saveDraft(key: string, value: string): void {
  try {
    if (!value.trim()) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, JSON.stringify({ value, at: currentEpochMilliseconds() } satisfies StoredDraft))
  } catch {
    /*
     * Quota exceeded or storage blocked. Draft persistence is a convenience, never a
     * precondition for editing — degrade silently.
     */
  }
}

export const clearDraft = function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {}
}

/**
 * Drop every stored draft. Intended for logout, so one user's unsent text isn't left
 * behind for the next person on a shared device.
 */
export const clearAllDrafts = function clearAllDrafts(): void {
  try {
    Iterable.forEach(Object.keys(sessionStorage), (key) => {
      if (key.startsWith(PREFIX)) {
        sessionStorage.removeItem(key)
      }
    })
  } catch {}
}
