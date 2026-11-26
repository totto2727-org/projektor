import type { RequestScope } from './server/request-context.ts'

/**
 * Pure URL construction, usable by server loaders as well as interactive components.
 *
 * @param {string} path The target URL or relative path.
 * @param {RequestScope | null} scope The current request scope, when available.
 * @returns {string} The relative URL with selectors for the current workspace and project.
 */
export const scopedHref = function scopedHref(path: string, scope: RequestScope | null): string {
  const url = new URL(path, 'https://frontend.invalid')
  const selection = scope?.selection
  if (selection?.kind === 'workspace' || selection?.kind === 'project') {
    url.searchParams.set('workspace', selection.workspace.slug)
  }
  if (selection?.kind === 'project') {
    url.searchParams.set('projectId', selection.project.id)
  }
  return `${url.pathname}${url.search}${url.hash}`
}
