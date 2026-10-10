import type { RequestScope } from './server/request-context'

/** Pure URL construction, usable by server loaders as well as interactive components. */
export function scopedHref(path: string, scope: RequestScope | null): string {
  const url = new URL(path, 'https://frontend.invalid')
  const selection = scope?.selection
  if (selection?.kind === 'workspace' || selection?.kind === 'project') {
    url.searchParams.set('workspace', selection.workspace.slug)
  }
  if (selection?.kind === 'project') url.searchParams.set('projectId', selection.project.id)
  return `${url.pathname}${url.search}${url.hash}`
}
