import { isNull, or, sql, type SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Effect, Schema } from 'effect'
import type React from 'react'

import { schema } from '#db'
import { listAttachments } from '#services/files'
import * as wikiData from '#services/wiki'

import { loadBrand } from '../../brand'
import { renderMarkdownEffect } from '../../components/markdown/effect'
import { type PageFailure, RequestServices } from '../../request'
import type { RequestApi } from '../../server/api-client'
import {
  authorizeDataEntity,
  dataError,
  requireDataDatabase,
  requireDataProject,
  requireDataWorkspace,
  visibleProjectPredicate,
} from '../../server/data-context'
import { ApiError, ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { stripFrontmatter } from './render-markdown'
import { Attachment, Draft, ListItem, Page, Revision, SearchResult, StalePage, Template, Tree } from './schemas'
import { WikiPageClient, type WikiSeed } from './WikiPageClient'

/** Application DTO policy, matching the API's derived freshness rather than storing it. */
function freshness(
  row: { verified_at: number | null; verify_interval: number | null; status: string | null },
  now: number,
) {
  const due =
    row.verified_at !== null && row.verify_interval !== null ? row.verified_at + row.verify_interval * 86400 : null
  if (row.status === null && row.verify_interval === null) return null
  if (row.status === 'stale' || row.status === 'deprecated')
    return { state: 'stale' as const, staleSince: due !== null && due <= now ? due : null }
  if (row.verify_interval !== null && row.verified_at === null)
    return { state: 'unverified' as const, staleSince: null }
  return due !== null && due <= now
    ? { state: 'stale' as const, staleSince: due }
    : { state: 'fresh' as const, staleSince: null }
}

/** The request owns authorization, presentation and rendering. Shared queries own only SQL. */
export function renderWiki(
  _api: RequestApi,
  scope: RequestScope,
  url: URL,
  params: Readonly<Record<string, string | undefined>> = {},
): Effect.Effect<React.ReactElement, PageFailure, RequestServices> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    const selected = scope.selection
    if (selected.kind !== 'project' && selected.kind !== 'workspace')
      return (
        <section className='p-6 bg-surface border border-border rounded-lg'>
          <h1>Choose a workspace</h1>
          <p className='text-text-muted'>Select a workspace before opening the wiki.</p>
        </section>
      )
    const workspace = yield* Effect.try({
      try: () => requireDataWorkspace(scope, selected.workspace.id),
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const db = yield* Effect.try({ try: () => requireDataDatabase(services.db), catch: dataError })
    const workspaceSlug = workspace.slug
    const ref = params.slug ?? url.searchParams.get('slug') ?? url.searchParams.get('id') ?? ''
    const projectId =
      selected.kind === 'project' && url.searchParams.get('scope') !== 'workspace' ? selected.project.id : ''
    const visibility = yield* Effect.try({
      try: () => {
        if (projectId) requireDataProject(scope, projectId, workspace.id)
        const predicate = visibleProjectPredicate(scope, workspace.id, schema.wikiPages.projectId)
        return predicate ? or(isNull(schema.wikiPages.projectId), predicate) : undefined
      },
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const mode =
      /\/wiki\/new\/?$/.test(url.pathname) || url.searchParams.get('createTitle')
        ? 'create'
        : /\/edit\/?$/.test(url.pathname)
          ? 'edit'
          : 'read'
    const filterType = url.searchParams.get('type') ?? ''
    const filterStatus = url.searchParams.get('status') ?? ''
    const filterTags = url.searchParams.get('tags') ?? ''
    const searchQuery = url.searchParams.get('q') ?? ''
    const now = Math.floor(Date.now() / 1000)
    const options = {
      ...(projectId ? { projectId, includeWorkspacePages: true } : {}),
      visibility,
    }
    const filters = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        type: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50))),
        status: Schema.optional(Schema.Literals(['draft', 'current', 'stale', 'deprecated'])),
        tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String).check(Schema.isMaxLength(50)))),
      }),
    )({
      ...(filterType ? { type: filterType } : {}),
      ...(filterStatus ? { status: filterStatus } : {}),
      ...(filterTags
        ? {
            tags: filterTags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
          }
        : {}),
    }).pipe(Effect.mapError(() => new ApiError('http', 400, 'Invalid wiki filters.')))
    const row = ref ? yield* wikiData.findWikiPage(db, workspace.id, ref).pipe(Effect.mapError(dataError)) : undefined
    if (row)
      yield* Effect.try({
        try: () => authorizeDataEntity(scope, workspace.id, { ...row, projectId: row.project_id }),
        catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      })
    const page = row
      ? yield* Schema.decodeUnknownEffect(Page)({
          ...row,
          revisionId: yield* wikiData
            .getLatestWikiRevisionId(db, workspace.id, row.id)
            .pipe(Effect.mapError(dataError)),
          freshness: freshness(row, now),
        }).pipe(Effect.mapError(dataError))
      : null
    const treeRows = yield* wikiData.listWikiTreeRows(db, workspace.id, options).pipe(Effect.mapError(dataError))
    const nodes = new Map<string, WikiSeed['tree'][number]>()
    for (const item of treeRows)
      nodes.set(item.id, {
        id: item.id,
        slug: item.slug,
        title: item.title,
        type: item.type,
        children: [],
      })
    const roots: WikiSeed['tree'] = []
    for (const item of treeRows) {
      const node = nodes.get(item.id)!
      const parent = item.parentId ? nodes.get(item.parentId) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    const ftsQuery = searchQuery
      .trim()
      .split(/\s+/)
      .filter((token) => Boolean(token) && /\w/.test(token))
      .map((token) => `"${token.replace(/"/g, '""')}"`)
      .join(' ')
    // Serialize the same app-authored visibility predicate for the shared raw FTS query.
    const rawVisibility = yield* Effect.try({
      try: () => {
        const fragment = (column: SQL) => {
          const predicate = visibleProjectPredicate(scope, workspace.id, column)
          return predicate ? new SQLiteSyncDialect().sqlToQuery(sql`${column} IS NULL OR ${predicate}`) : undefined
        }
        return { search: fragment(sql`p.project_id`), linkedWiki: fragment(sql`w.project_id`) }
      },
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
    })
    const data = yield* Effect.all(
      {
        brand: loadBrand(services.api, scope),
        tree: Schema.decodeUnknownEffect(Tree)(roots).pipe(Effect.mapError(dataError)),
        templates: wikiData
          .listWikiTemplates(db, workspace.id, { visibility })
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(Template)))),
            Effect.mapError(dataError),
          ),
        stalePages: wikiData.listStaleWikiPages(db, workspace.id, { ...options, now, limit: 50, offset: 0 }).pipe(
          Effect.map((rows) => rows.map((item) => ({ ...item, freshness: freshness(item, now) }))),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(StalePage)))),
          Effect.mapError(dataError),
        ),
        filteredPages:
          filterType || filterStatus || filterTags
            ? wikiData
                .listWikiPages(db, workspace.id, { ...options, ...filters })
                .pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(ListItem)))),
                  Effect.mapError(dataError),
                )
            : Effect.succeed([]),
        searchResults: searchQuery
          ? wikiData
              .searchWiki(db, workspace.id, ftsQuery, {
                ...options,
                ...filters,
                now,
                limit: 10,
                offset: 0,
                visibilitySql: rawVisibility.search,
              })
              .pipe(
                Effect.map((rows) =>
                  rows.map((item: wikiData.WikiSearchResult) => ({
                    ...item,
                    freshness: freshness(item, now),
                  })),
                ),
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(SearchResult)))),
                Effect.mapError(dataError),
              )
          : Effect.succeed([]),
        revisions: page
          ? wikiData
              .listWikiRevisions(db, workspace.id, page.id)
              .pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(Revision)))),
                Effect.mapError(dataError),
              )
          : Effect.succeed([]),
        attachments: page
          ? listAttachments(db, workspace.id, {
              entityType: 'wiki_page',
              entityId: page.id,
              // The owner page was authorized above. A wiki_ref target is checked separately.
              linkedWikiVisibility: rawVisibility.linkedWiki,
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(Attachment)))),
              Effect.mapError(dataError),
            )
          : Effect.succeed([]),
        draftResult:
          page && scope.user.email !== 'public-viewer@projektor.local'
            ? wikiData.getWikiDraft(db, workspace.id, page.id, scope.user.id).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Draft)),
                Effect.mapError(dataError),
                Effect.map((draft) => ({ draft, status: 'ready' as const })),
                Effect.catch(() => Effect.succeed({ draft: null, status: 'failed' as const })),
              )
            : Effect.succeed({ draft: null, status: 'ready' as const }),
      },
      { concurrency: 4 },
    )
    const wikiPages = (children: typeof data.tree): Array<{ title: string; slug: string }> =>
      children.flatMap(({ title, slug, children: nested }) => [{ title, slug }, ...wikiPages(nested)])
    const renderedMarkdown = yield* renderMarkdownEffect(stripFrontmatter(page?.content ?? ''), {
      pages: wikiPages(data.tree),
      workspaceSlug,
      projectId,
    }).pipe(Effect.mapError((cause) => new ApiError('request', 500, cause.message, cause.cause)))
    const initial: WikiSeed = {
      renderedMarkdown,
      page,
      tree: data.tree,
      templates: data.templates,
      stalePages: data.stalePages,
      filteredPages: data.filteredPages,
      searchResults: data.searchResults,
      revisions: data.revisions,
      attachments: data.attachments,
      draft: data.draftResult.draft,
      draftStatus: data.draftResult.status,
      projects: scope.projects
        .filter((project) => project.workspace_slug === workspaceSlug)
        .map((project) => ({
          id: project.id,
          key: project.key,
          name: project.name,
          workspace_slug: project.workspace_slug,
        })),
      workspaceSlug,
      projectId,
      slug: ref,
      filterType,
      filterStatus,
      filterTags,
      searchQuery,
      createTitle: url.searchParams.get('createTitle') ?? '',
      mode,
      publicViewer: scope.user.email === 'public-viewer@projektor.local',
      brandName: data.brand.name,
    }
    return <WikiPageClient initial={initial} />
  })
}
