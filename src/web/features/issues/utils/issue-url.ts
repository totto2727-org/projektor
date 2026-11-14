import { slugify } from '../lib/slugify'
/** Issue identity crosses route boundaries with explicit authorized workspace scope. */
export function issueUrl(
  projectSlug: string | null | undefined,
  issueNumber: number,
  title: string,
  fallbackId?: string,
  workspaceSlug?: string,
): string {
  if (!projectSlug && !fallbackId) return '#'
  const url = new URL(
    projectSlug
      ? `/projects/${encodeURIComponent(projectSlug)}/issues/${issueNumber}/${slugify(title)}`
      : '/issues/view',
    'https://frontend.invalid',
  )
  if (!projectSlug && fallbackId) url.searchParams.set('id', fallbackId)
  if (workspaceSlug) url.searchParams.set('workspace', workspaceSlug)
  return `${url.pathname}${url.search}${url.hash}`
}
