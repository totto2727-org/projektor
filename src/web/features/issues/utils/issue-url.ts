import { String, Predicate } from 'effect'

import { slugify } from '@/features/issues/lib/slugify.ts'
/**
 * Issue identity crosses route boundaries with explicit authorized workspace scope.
 *
 * @param {string | null | undefined} projectSlug The authorized project's route slug, when available.
 * @param {number} issueNumber The issue number within its project.
 * @param {string} title The title used to form the last segment of the canonical URL.
 * @param {string} fallbackId The issue ID to use when a project route is unavailable.
 * @param {string} workspaceSlug The authorized workspace selector to carry in the URL.
 * @returns {string} The relative issue URL, or a fragment when no issue route can be formed.
 */
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
