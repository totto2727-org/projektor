import { Effect } from 'effect'
import type React from 'react'

import { loadBrand } from '@/brand.ts'
import { renderMarkdownEffect } from '@/components/markdown/effect.ts'
import { browserRequest, coreResult } from '@/core.ts'
import { RequestServices } from '@/request.ts'
import type { PageFailure } from '@/request.ts'
import { ApiError } from '@/server/errors.ts'
import type { RequestScope } from '@/server/request-context.ts'

import { stripFrontmatter } from './render-markdown.ts'
import { WikiSeedDataSchema } from './schemas.ts'
import { WikiPageClient } from './wiki-page-client.tsx'
import type { WikiSeed } from './wiki-page-client.tsx'

/** Native Effront SSR keeps presentation and markdown rendering, never storage. */
export function renderWiki(
  scope: RequestScope,
  url: URL,
  params: Readonly<Record<string, string | undefined>> = {},
): Effect.Effect<React.ReactElement, PageFailure, RequestServices> {
  return Effect.gen(function* () {
    const selected = scope.selection
    if (selected.kind !== 'project' && selected.kind !== 'workspace') {
      return (
        <section className='p-6 bg-surface border border-border rounded-lg'>
          <h1>Choose a workspace</h1>
          <p className='text-text-muted'>Select a workspace before opening the wiki.</p>
        </section>
      )
    }
    const services = yield* RequestServices
    const data = yield* coreResult(
      WikiSeedDataSchema,
      services.core.webWikiSeed(
        browserRequest(services.request),
        selected.workspace.id,
        url.toString(),
        params.slug,
        selected.kind === 'project' ? selected.project.id : undefined,
      ),
    )
    const wikiPages = (children: typeof data.tree): { title: string; slug: string }[] =>
      children.flatMap(({ title, slug, children: nested }) => [{ title, slug }, ...wikiPages(nested)])
    const renderedMarkdown = yield* renderMarkdownEffect(stripFrontmatter(data.page?.content ?? ''), {
      pages: wikiPages(data.tree),
      workspaceSlug: data.workspaceSlug,
      projectId: data.projectId,
    }).pipe(Effect.mapError((cause) => new ApiError('request', 500, cause.message, cause.cause)))
    const brand = yield* loadBrand(services.env, scope, services.request)
    const initial: WikiSeed = { ...data, renderedMarkdown, brandName: brand.name }
    return <WikiPageClient initial={initial} />
  })
}
