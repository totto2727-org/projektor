import { String, Predicate } from 'effect'

import { slugify } from '@/features/issues/lib/slugify.ts'
/** Issue identity crosses route boundaries with explicit authorized workspace scope. */
export const issueUrl = function issueUrl(
  projectSlug: string | null | undefined,
  issueNumber: number,
  title: string,
  fallbackId?: string,
  workspaceSlug?: string,
): string {
  if (
    (Predicate.isNullish(projectSlug) || String.isEmpty(projectSlug)) &&
    (Predicate.isNullish(fallbackId) || String.isEmpty(fallbackId))
  ) {
    return '#'
  }
  const url = new URL(
    Predicate.isNotNullish(projectSlug) && String.isNonEmpty(projectSlug)
      ? `/projects/${encodeURIComponent(projectSlug)}/issues/${issueNumber}/${slugify(title)}`
      : '/issues/view',
    'https://frontend.invalid',
  )
  if (
    (Predicate.isNullish(projectSlug) || String.isEmpty(projectSlug)) &&
    Predicate.isNotNullish(fallbackId) &&
    String.isNonEmpty(fallbackId)
  ) {
    url.searchParams.set('id', fallbackId)
  }
  if (Predicate.isNotNullish(workspaceSlug) && String.isNonEmpty(workspaceSlug)) {
    url.searchParams.set('workspace', workspaceSlug)
  }
  return `${url.pathname}${url.search}${url.hash}`
}
