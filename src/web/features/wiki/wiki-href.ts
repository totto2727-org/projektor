import type { WikiSeed } from './wiki-page-model.ts'

export const wikiHref = function wikiHref(seed: Pick<WikiSeed, 'workspaceSlug' | 'projectId'>, path: string): string {
  const url = new URL(path, 'https://wiki.invalid')
  url.searchParams.set('workspace', seed.workspaceSlug)
  if (seed.projectId) {
    url.searchParams.set('projectId', seed.projectId)
  } else {
    url.searchParams.set('scope', 'workspace')
  }
  return `${url.pathname}${url.search}${url.hash}`
}
