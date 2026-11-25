import { Effect, Schema } from 'effect'
import type { Types } from 'effect'

import type { ReviewFilter } from '#contracts/review-targets.ts'
import { browserRequest, coreResult } from '@/core.ts'
import { SprintSchema } from '@/features/planning/schemas.ts'
import { RequestServices } from '@/request.ts'
import type { PageFailure } from '@/request.ts'
import { dataError } from '@/server/data-context.ts'
import { ScopeError } from '@/server/errors.ts'
import type { RequestScope } from '@/server/request-context.ts'

import { SearchResultsSchema, WikiSearchResultsSchema } from './action-schemas.ts'
import {
  AttachmentsSchema,
  CommentsSchema,
  IssuePageSchema,
  IssueSchema,
  LinksSchema,
  MemberSchema,
  StatusesSchema,
  TaskTypesSchema,
  normalizeAttachments,
  normalizeComments,
  normalizeIssue,
  normalizeIssuePage,
  normalizeLinks,
  normalizeStatuses,
  normalizeTaskTypes,
} from './types.ts'
import type { Attachment, Comment, Issue, IssueLink, IssuePage, Status, TaskType } from './types.ts'

type IssueRead<A> = Effect.Effect<A, PageFailure, RequestServices>
type IssueSearchResult = Types.Mutable<(typeof SearchResultsSchema.Type)[number]>
type WikiAttachmentSearchResult = Types.Mutable<(typeof WikiSearchResultsSchema.Type)[number]>

export const checked = function checked<A>(read: () => A): Effect.Effect<A, PageFailure> {
  return Effect.try({ catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)), try: read })
}

export const readDataIssue = function readDataIssue(
  _scope: RequestScope,
  workspaceId: string,
  identifier: string,
  projectId?: string,
): IssueRead<Issue> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      IssueSchema,
      services.core.webIssue(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeIssue))
  })
}
export const readDataIssuePage = function readDataIssuePage(
  _scope: RequestScope,
  workspaceId: string,
  params: URLSearchParams,
): IssueRead<IssuePage> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      IssuePageSchema,
      services.core.webIssuePage(browserRequest(services.request), workspaceId, params.toString()),
    ).pipe(Effect.map(normalizeIssuePage))
  })
}
export const searchDataIssues = function searchDataIssues(
  _scope: RequestScope,
  workspaceId: string,
  query: string,
  projectId?: string,
  review?: ReviewFilter,
): IssueRead<IssueSearchResult[]> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      SearchResultsSchema,
      services.core.webIssueSearch(browserRequest(services.request), workspaceId, query, projectId, review),
    ).pipe(Effect.map((rows) => rows.map((row) => ({ ...row }))))
  })
}
export const readDataComments = function readDataComments(
  _scope: RequestScope,
  workspaceId: string,
  identifier: string,
  projectId?: string,
): IssueRead<Comment[]> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      CommentsSchema,
      services.core.webIssueComments(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeComments))
  })
}
export const readDataLinks = function readDataLinks(
  _scope: RequestScope,
  workspaceId: string,
  identifier: string,
  projectId?: string,
): IssueRead<IssueLink[]> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      LinksSchema,
      services.core.webIssueLinks(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeLinks))
  })
}
export const readDataAttachments = function readDataAttachments(
  _scope: RequestScope,
  workspaceId: string,
  identifier: string,
  projectId?: string,
): IssueRead<Attachment[]> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      AttachmentsSchema,
      services.core.webIssueAttachments(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeAttachments))
  })
}
export const searchDataWikiAttachments = function searchDataWikiAttachments(
  _scope: RequestScope,
  workspaceId: string,
  query: string,
): IssueRead<WikiAttachmentSearchResult[]> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      WikiSearchResultsSchema,
      services.core.webWikiAttachmentSearch(browserRequest(services.request), workspaceId, query),
    ).pipe(Effect.map((rows) => rows.map((row) => ({ ...row }))))
  })
}
export const readIssueLookups = function readIssueLookups(
  workspaceId: string,
): IssueRead<{ statuses: Status[]; taskTypes: TaskType[] }> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      Schema.Struct({ statuses: StatusesSchema, taskTypes: TaskTypesSchema }),
      services.core.webIssueLookups(browserRequest(services.request), workspaceId),
    ).pipe(
      Effect.map((data) => ({
        statuses: normalizeStatuses(data.statuses),
        taskTypes: normalizeTaskTypes(data.taskTypes),
      })),
    )
  })
}
export const readIssueMembers = function readIssueMembers(
  workspaceId: string,
): IssueRead<Readonly<(typeof MemberSchema.Type)[]>> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      Schema.Array(MemberSchema),
      services.core.webIssueMembers(browserRequest(services.request), workspaceId),
    )
  })
}
export const readSprints = function readSprints(
  workspaceId: string,
  projectId: string,
): IssueRead<Readonly<(typeof SprintSchema.Type)[]>> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      Schema.Array(SprintSchema),
      services.core.webSprints(browserRequest(services.request), workspaceId, projectId),
    )
  })
}
export const readSprint = function readSprint(
  workspaceId: string,
  sprintId: string,
): IssueRead<typeof SprintSchema.Type> {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      SprintSchema,
      services.core.webSprint(browserRequest(services.request), workspaceId, sprintId),
    )
  })
}
