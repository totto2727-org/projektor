'use client'

/** Ordinary browser navigation, intercepted by Effront without a feature router. */
export const navigateFeature = function navigateFeature(path: string): void {
  window.location.assign(path)
}
