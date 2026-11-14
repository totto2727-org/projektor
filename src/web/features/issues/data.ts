import { Effect, Schema } from 'effect'

import type { ReviewFilter } from '../../../contracts/review-targets'
import { browserRequest, coreResult } from '../../core'
import { RequestServices } from '../../request'
import { dataError } from '../../server/data-context'
import { ScopeError } from '../../server/errors'
import type { RequestScope } from '../../server/request-context'
import { SprintSchema } from '../planning/schemas'
import { SearchResultsSchema, WikiSearchResultsSchema } from './action-schemas'
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
} from './types'

export function checked<A>(read: () => A) {
  return Effect.try({ try: read, catch: (cause) => (cause instanceof ScopeError ? cause : dataError(cause)) })
}

export function readDataIssue(_scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      IssueSchema,
      services.core.webIssue(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeIssue))
  })
}
export function readDataIssuePage(_scope: RequestScope, workspaceId: string, params: URLSearchParams) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      IssuePageSchema,
      services.core.webIssuePage(browserRequest(services.request), workspaceId, params.toString()),
    ).pipe(Effect.map(normalizeIssuePage))
  })
}
export function searchDataIssues(
  _scope: RequestScope,
  workspaceId: string,
  query: string,
  projectId?: string,
  review?: ReviewFilter,
) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      SearchResultsSchema,
      services.core.webIssueSearch(browserRequest(services.request), workspaceId, query, projectId, review),
    ).pipe(Effect.map((rows) => rows.map((row) => ({ ...row }))))
  })
}
export function readDataComments(_scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      CommentsSchema,
      services.core.webIssueComments(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeComments))
  })
}
export function readDataLinks(_scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      LinksSchema,
      services.core.webIssueLinks(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeLinks))
  })
}
export function readDataAttachments(_scope: RequestScope, workspaceId: string, identifier: string, projectId?: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      AttachmentsSchema,
      services.core.webIssueAttachments(browserRequest(services.request), workspaceId, identifier, projectId),
    ).pipe(Effect.map(normalizeAttachments))
  })
}
export function searchDataWikiAttachments(_scope: RequestScope, workspaceId: string, query: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      WikiSearchResultsSchema,
      services.core.webWikiAttachmentSearch(browserRequest(services.request), workspaceId, query),
    ).pipe(Effect.map((rows) => rows.map((row) => ({ ...row }))))
  })
}
export function readIssueLookups(workspaceId: string) {
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
export function readIssueMembers(workspaceId: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      Schema.Array(MemberSchema),
      services.core.webIssueMembers(browserRequest(services.request), workspaceId),
    )
  })
}
export function readSprints(workspaceId: string, projectId: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      Schema.Array(SprintSchema),
      services.core.webSprints(browserRequest(services.request), workspaceId, projectId),
    )
  })
}
export function readSprint(workspaceId: string, sprintId: string) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      SprintSchema,
      services.core.webSprint(browserRequest(services.request), workspaceId, sprintId),
    )
  })
}
