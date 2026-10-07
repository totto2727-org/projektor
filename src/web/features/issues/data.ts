import { sql } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { Effect, Schema } from 'effect'

import { schema } from '#db'
import { listComments } from '#services/comments'
import { type AttachmentMetadata, listAttachments } from '#services/files'
import { listLinksForIssue } from '#services/issue-links'
import * as issueQueries from '#services/issues'
import { searchWiki } from '#services/wiki'

import { RequestServices } from '../../request'
import {
  authorizeDataEntity,
  dataError,
  requireDataProject,
  requireDataWorkspace,
  visibleProjectPredicate,
} from '../../server/data-context'
import { ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { WikiSearchResultsSchema } from './action-schemas'
import { normalizeAttachments, normalizeComments, normalizeIssue, normalizeIssuePage, normalizeLinks } from './types'

/** Keep application policy failures, and redact storage failures before reaching a client. */
export function checked<A>(read: () => A) {
  return Effect.try({
    try: read,
    catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)),
  })
}
const BooleanQuery = Schema.Literals(['true', '1', 'false', '0', ''])
const NumericQuery = Schema.NumberFromString.check(Schema.isFinite())
const IssueListQuerySchema = Schema.fromURLSearchParams(
  Schema.Struct({
    status: Schema.optional(Schema.Literals(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'])),
    priority: Schema.optional(Schema.Literals(['urgent', 'high', 'medium', 'low', 'none'])),
    category: Schema.optional(Schema.Literals(['todo', 'in_progress', 'done', 'cancelled'])),
    statusId: Schema.optional(Schema.String),
    statusIds: Schema.optional(Schema.String),
    priorities: Schema.optional(Schema.String),
    parentId: Schema.optional(Schema.String),
    typeId: Schema.optional(Schema.String),
    excludeTypeIds: Schema.optional(Schema.String),
    sprintId: Schema.optional(Schema.String),
    assignee: Schema.optional(Schema.String),
    noParent: Schema.optional(BooleanQuery),
    includeRollups: Schema.optional(BooleanQuery),
    includeBody: Schema.optional(BooleanQuery),
    needsAudit: Schema.optional(BooleanQuery),
    completedAfter: Schema.optional(NumericQuery),
    completedBefore: Schema.optional(NumericQuery),
    updatedAfter: Schema.optional(NumericQuery),
    updatedBefore: Schema.optional(NumericQuery),
    cursor: Schema.optional(Schema.String.check(Schema.isPattern(/^\d+(?::[A-Za-z0-9-]+)?$/))),
    limit: Schema.optional(NumericQuery.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }))),
    cfKey: Schema.optional(Schema.String),
    cfValue: Schema.optional(Schema.String),
    cfOp: Schema.optional(Schema.Literals(['eq', 'gt', 'gte', 'lt', 'lte'])),
  }),
)
function listOptions(params: URLSearchParams, scope: RequestScope) {
  return Schema.decodeUnknownEffect(IssueListQuerySchema)(params).pipe(
    Effect.mapError(() => new ScopeError(400, 'Invalid issue filters or cursor.')),
    Effect.map(
      ({ cursor, noParent, includeRollups, includeBody, needsAudit, assignee, cfKey, cfValue, cfOp, ...fields }) => {
        const [createdAt, id] = cursor?.split(':') ?? []
        const boolean = (value: string | undefined) =>
          value === undefined ? undefined : value === '1' || value === 'true'
        return {
          options: {
            ...fields,
            limit: fields.limit ?? 30,
            cursor: cursor ? { createdAt: Number(createdAt), id } : undefined,
            noParent: boolean(noParent),
            includeRollups: boolean(includeRollups),
            includeBody: boolean(includeBody),
            needsAudit: boolean(needsAudit),
            assignee: assignee === 'me' ? scope.user.id : assignee,
          } satisfies issueQueries.IssueListOptions,
          cfKey,
          cfValue,
          cfOp,
        }
      },
    ),
  )
}

export function readDataIssue(scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const { db } = yield* RequestServices
    yield* checked(() => requireDataWorkspace(scope, workspaceId))
    const row = yield* issueQueries
      .getIssue(
        db,
        workspaceId,
        issueQueries.ISSUE_REF_PATTERN.test(identifier) ? { ref: identifier } : { id: identifier },
      )
      .pipe(Effect.mapError(dataError))
    if (!row) return yield* new ScopeError(404, 'Issue not found.')
    yield* checked(() => authorizeDataEntity(scope, workspaceId, { projectId: row.project_id }))
    if (projectId && row.project_id !== projectId)
      return yield* new ScopeError(404, 'Issue not found in the selected project.')
    const extras = yield* issueQueries.getIssueExtras(db, workspaceId, row.id).pipe(Effect.mapError(dataError))
    return normalizeIssue({ ...row, ...extras })
  })
}
export function readDataIssuePage(scope: RequestScope, workspaceId: string, params: URLSearchParams) {
  return Effect.gen(function* () {
    const { db } = yield* RequestServices
    yield* checked(() => requireDataWorkspace(scope, workspaceId))
    const decoded = yield* listOptions(params, scope)
    const options: issueQueries.IssueListOptions = decoded.options
    const projectValue = params.get('project')
    if (projectValue) {
      const project = scope.projects.find(
        (entry) => entry.workspace_id === workspaceId && (entry.id === projectValue || entry.key === projectValue),
      )
      options.projectId = (yield* checked(() => requireDataProject(scope, project?.id ?? projectValue, workspaceId))).id
    }
    if (options.parentId && issueQueries.ISSUE_REF_PATTERN.test(options.parentId))
      options.parentId = (yield* readDataIssue(scope, workspaceId, options.parentId)).id
    const { cfKey, cfOp, cfValue } = decoded
    if (cfKey) {
      const field = yield* issueQueries.findIssueCustomField(db, workspaceId, cfKey).pipe(Effect.mapError(dataError))
      if (!field) return yield* new ScopeError(400, 'Unknown custom field key.')
      options.customField = { id: field.id, op: cfOp ?? 'eq', value: cfValue ?? '' }
    }
    const visibility = yield* checked(() => visibleProjectPredicate(scope, workspaceId, schema.issues.projectId))
    return normalizeIssuePage(
      yield* issueQueries.listIssues(db, workspaceId, options, visibility).pipe(Effect.mapError(dataError)),
    )
  })
}
export function searchDataIssues(scope: RequestScope, workspaceId: string, query: string, projectId?: string) {
  return Effect.gen(function* () {
    const { db } = yield* RequestServices
    yield* checked(() => requireDataWorkspace(scope, workspaceId))
    if (projectId) yield* checked(() => requireDataProject(scope, projectId, workspaceId))
    if (!query.length) return yield* new ScopeError(400, 'A search query is required.')
    const predicate = yield* checked(() => visibleProjectPredicate(scope, workspaceId, sql`i.project_id`))
    const visibility = predicate ? new SQLiteSyncDialect().sqlToQuery(predicate) : undefined
    return yield* issueQueries
      .searchIssues(db, workspaceId, { query, projectId, limit: 20 }, visibility)
      .pipe(Effect.mapError(dataError))
  })
}
export function readDataComments(scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const { db } = yield* RequestServices
    const issue = yield* readDataIssue(scope, workspaceId, identifier, projectId)
    return normalizeComments(yield* listComments(db, workspaceId, issue.id).pipe(Effect.mapError(dataError)))
  })
}
export function readDataLinks(scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const { db } = yield* RequestServices
    const issue = yield* readDataIssue(scope, workspaceId, identifier, projectId)
    return normalizeLinks(yield* listLinksForIssue(db, workspaceId, issue.id).pipe(Effect.mapError(dataError)))
  })
}
export function readDataAttachments(scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const { db } = yield* RequestServices
    const issue = yield* readDataIssue(scope, workspaceId, identifier, projectId)
    const predicate = yield* checked(() => visibleProjectPredicate(scope, workspaceId, sql`w.project_id`))
    const linkedWikiVisibility = predicate ? new SQLiteSyncDialect().sqlToQuery(predicate) : undefined
    const rows = yield* listAttachments(db, workspaceId, {
      entityType: 'issue',
      entityId: issue.id,
      linkedWikiVisibility,
    }).pipe(Effect.mapError(dataError))
    return normalizeAttachments(
      rows.map((row: AttachmentMetadata) => ({
        ...row,
        wikiPage: row.wikiPage
          ? {
              id: row.wikiPage.id,
              title: row.wikiPage.title ?? '',
              url: `/wiki/${encodeURIComponent(row.wikiPage.slug ?? '')}`,
            }
          : null,
      })),
    )
  })
}

export function searchDataWikiAttachments(scope: RequestScope, workspaceId: string, query: string) {
  return Effect.gen(function* () {
    const { db } = yield* RequestServices
    yield* checked(() => requireDataWorkspace(scope, workspaceId))
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .filter((word) => /\w/.test(word))
      .map((word) => `"${word.replace(/"/g, '""')}"`)
      .join(' ')
    if (!ftsQuery) return []
    const predicate = yield* checked(() => visibleProjectPredicate(scope, workspaceId, sql`p.project_id`))
    const visibilitySql = predicate
      ? new SQLiteSyncDialect().sqlToQuery(sql`p.project_id IS NULL OR ${predicate}`)
      : undefined
    const rows = yield* searchWiki(db, workspaceId, ftsQuery, {
      limit: 10,
      offset: 0,
      now: Math.floor(Date.now() / 1000),
      visibilitySql,
    }).pipe(Effect.mapError(dataError))
    // Wiki searches expose broad metadata, while this picker deliberately consumes identity only.
    return yield* Schema.decodeUnknownEffect(WikiSearchResultsSchema)(rows).pipe(Effect.mapError(dataError))
  })
}
