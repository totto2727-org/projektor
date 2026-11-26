'use client'

/**
 * Ordinary browser navigation, intercepted by Effront without a feature router.
 *
 * @param {string} path The feature route to load.
 */
export const navigateFeature = function navigateFeature(path: string): void {
  window.location.assign(path)
}
