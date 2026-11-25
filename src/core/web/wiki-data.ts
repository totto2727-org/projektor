import { isNull, or, sql } from 'drizzle-orm'
import type { QueryWithTypings, SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Iterable, Effect, Schema } from 'effect'

import { readWikiDraftState } from '#commands/wiki-drafts.ts'
import { ApiError, ScopeError } from '#contracts/errors.ts'
import { HTTP_FORBIDDEN, HTTP_BAD_REQUEST } from '#contracts/http-status.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import {
  Attachment,
  DraftState,
  ListItem,
  Page,
  Revision,
  SearchResult,
  StalePage,
  Template,
  Tree,
} from '#contracts/web-schemas/wiki.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { schema } from '#db'
import { listAttachments } from '#services/files.ts'
import * as wikiData from '#services/wiki.ts'
import type { WikiSeed } from '@/features/wiki/wiki-page-client.tsx'

import {
  dataError,
  requireDataDatabase,
  requireDataProject,
  requireDataWorkspace,
  visibleProjectPredicate,
} from './data-context.ts'
import type { RequestScope } from './scope.ts'
import { pageFreshness as freshness, readAuthorizedWikiPage } from './wiki-policy.ts'

const wikiFilterFields = fieldsInOrder([
  ['type', Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)))],
  ['status', Schema.optional(Schema.Literals(['draft', 'current', 'stale', 'deprecated']))],
  ['tags', Schema.optional(Schema.mutable(Schema.Array(Schema.String).check(Schema.isMaxLength(50))))],
])

const decodeWikiFilters = Schema.decodeUnknownEffect(Schema.Struct(wikiFilterFields))
const decodeWikiPage = Schema.decodeUnknownEffect(Page)
const decodeWikiTree = Schema.decodeUnknownEffect(Tree)
const decodeWikiTemplates = Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(Template)))
const decodeStaleWikiPages = Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(StalePage)))
const decodeWikiListItems = Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(ListItem)))
const decodeWikiSearchResults = Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(SearchResult)))
const decodeWikiRevisions = Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(Revision)))
const decodeWikiAttachments = Schema.decodeUnknownEffect(Schema.mutable(Schema.Array(Attachment)))
const decodeWikiDraftState = Schema.decodeUnknownEffect(DraftState)

/** The request owns authorization, presentation and rendering. Shared queries own only SQL. */
export const loadWikiData = function loadWikiData(
  env: CoreEnvironment,
  scope: RequestScope,
  url: URL,
  params: Readonly<Record<string, string | undefined>> = {},
) {
  return Effect.gen(function* () {
    const selected = scope.selection
    if (selected.kind !== 'project' && selected.kind !== 'workspace') {
      return yield* new ScopeError(HTTP_FORBIDDEN, 'Select a workspace before opening the wiki.')
    }
    const workspace = yield* Effect.try({
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      try: () => requireDataWorkspace(scope, selected.workspace.id),
    })
    const db = yield* Effect.try({ catch: dataError, try: () => requireDataDatabase(env.DB) })
    const workspaceSlug = workspace.slug
    const ref = params.slug ?? url.searchParams.get('slug') ?? url.searchParams.get('id') ?? ''
    const projectId =
      selected.kind === 'project' && url.searchParams.get('scope') !== 'workspace' ? selected.project.id : ''
    const visibility = yield* Effect.try({
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      try: () => {
        if (projectId) {
          requireDataProject(scope, projectId, workspace.id)
        }
        const predicate = visibleProjectPredicate(scope, workspace.id, schema.wikiPages.projectId)
        return predicate ? or(isNull(schema.wikiPages.projectId), predicate) : undefined
      },
    })
    const mode =
      /\/wiki\/new\/?$/u.test(url.pathname) || url.searchParams.get('createTitle')
        ? 'create'
        : /\/edit\/?$/u.test(url.pathname)
          ? 'edit'
          : 'read'
    const filterType = url.searchParams.get('type') ?? ''
    const filterStatus = url.searchParams.get('status') ?? ''
    const filterTags = url.searchParams.get('tags') ?? ''
    const searchQuery = url.searchParams.get('q') ?? ''
    const now = currentEpochSeconds()
    const options = {
      ...(projectId ? { projectId, includeWorkspacePages: true } : {}),
      visibility,
    }

    const filters = yield* decodeWikiFilters({
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
    }).pipe(Effect.mapError(() => new ApiError('http', HTTP_BAD_REQUEST, 'Invalid wiki filters.')))
    const row = ref ? (yield* readAuthorizedWikiPage(db, scope, ref)).page : undefined
    const page = row
      ? yield* decodeWikiPage({
          ...row,
          revisionId: yield* wikiData
            .getLatestWikiRevisionId(db, workspace.id, row.id)
            .pipe(Effect.mapError(dataError)),
          freshness: freshness(row, now),
        }).pipe(Effect.mapError(dataError))
      : null
    const treeRows = yield* wikiData.listWikiTreeRows(db, workspace.id, options).pipe(Effect.mapError(dataError))
    const nodes = new Map<string, WikiSeed['tree'][number]>()
    Iterable.forEach(treeRows, (item) => {
      nodes.set(item.id, {
        id: item.id,
        slug: item.slug,
        title: item.title,
        type: item.type,
        children: [],
      })
    })
    const roots: WikiSeed['tree'] = []
    Iterable.forEach(treeRows, (item) => {
      const node = nodes.get(item.id)!
      const parent = item.parentId ? nodes.get(item.parentId) : undefined
      if (parent) {
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    })
    const ftsQuery = searchQuery
      .trim()
      .split(/\s+/u)
      .filter((token) => Boolean(token) && /\w/u.test(token))
      .map((token) => `"${token.replaceAll('"', '""')}"`)
      .join(' ')
    // Serialize the same app-authored visibility predicate for the shared raw FTS query.
    const rawVisibility = yield* Effect.try({
      catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
      try: () => {
        const fragment = (column: SQL): QueryWithTypings | undefined => {
          const predicate = visibleProjectPredicate(scope, workspace.id, column)
          return predicate ? new SQLiteSyncDialect().sqlToQuery(sql`${column} IS NULL OR ${predicate}`) : undefined
        }
        return fieldsInOrder([
          ['search', fragment(sql`p.project_id`)],
          ['linkedWiki', fragment(sql`w.project_id`)],
        ])
      },
    })
    const data = yield* Effect.all(
      {
        tree: decodeWikiTree(roots).pipe(Effect.mapError(dataError)),
        templates: wikiData
          .listWikiTemplates(db, workspace.id, { visibility })
          .pipe(Effect.flatMap(decodeWikiTemplates), Effect.mapError(dataError)),
        stalePages: wikiData.listStaleWikiPages(db, workspace.id, { ...options, now, limit: 50, offset: 0 }).pipe(
          Effect.map((rows) => rows.map((item) => ({ ...item, freshness: freshness(item, now) }))),
          Effect.flatMap(decodeStaleWikiPages),
          Effect.mapError(dataError),
        ),
        filteredPages:
          filterType || filterStatus || filterTags
            ? wikiData
                .listWikiPages(db, workspace.id, { ...options, ...filters })
                .pipe(Effect.flatMap(decodeWikiListItems), Effect.mapError(dataError))
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
                Effect.flatMap(decodeWikiSearchResults),
                Effect.mapError(dataError),
              )
          : Effect.succeed([]),
        revisions: page
          ? wikiData
              .listWikiRevisions(db, workspace.id, page.id)
              .pipe(Effect.flatMap(decodeWikiRevisions), Effect.mapError(dataError))
          : Effect.succeed([]),
        attachments: page
          ? listAttachments(db, workspace.id, {
              entityType: 'wiki_page',
              entityId: page.id,
              // The owner page was authorized above. A wiki_ref target is checked separately.
              linkedWikiVisibility: rawVisibility.linkedWiki,
            }).pipe(Effect.flatMap(decodeWikiAttachments), Effect.mapError(dataError))
          : Effect.succeed([]),
        draftResult:
          page && scope.user.email !== 'public-viewer@projektor.local'
            ? Effect.tryPromise({
                catch: dataError,
                try: async () =>
                  readWikiDraftState(
                    db,
                    fieldsInOrder([
                      ['workspaceId', workspace.id],
                      ['pageId', page.id],
                      ['userId', scope.user.id],
                    ]),
                  ),
              }).pipe(
                Effect.flatMap(decodeWikiDraftState),
                Effect.mapError(dataError),
                Effect.map((state) => ({ ...state, status: 'ready' as const })),
                Effect.catch(() => Effect.succeed({ draft: null, revision: null, status: 'failed' as const })),
              )
            : Effect.succeed({ draft: null, revision: null, status: 'ready' as const }),
      },
      { concurrency: 4 },
    )
    const initial = {
      page,
      tree: data.tree,
      templates: data.templates,
      stalePages: data.stalePages,
      filteredPages: data.filteredPages,
      searchResults: data.searchResults,
      revisions: data.revisions,
      attachments: data.attachments,
      draft: data.draftResult.draft,
      draftRevision: data.draftResult.revision,
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
    }
    return initial
  })
}
