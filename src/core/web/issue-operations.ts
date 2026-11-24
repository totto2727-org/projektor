import { Effect, Schema } from 'effect'

import { findSprintById, listSprints } from '#services/sprints.ts'
import { listTaskStatuses } from '#services/task-statuses.ts'
import { listTaskTypes } from '#services/task-types.ts'
import { listWorkspaceMembers } from '#services/workspaces.ts'

import { ScopeError } from '../../contracts/errors.ts'
import type { ReviewFilter } from '../../contracts/review-targets.ts'
import { SearchResultsSchema, WikiSearchResultsSchema } from '../../contracts/web-schemas/issue-actions.ts'
import {
  AttachmentsSchema,
  CommentsSchema,
  IssuePageSchema,
  IssueSchema,
  LinksSchema,
  MemberSchema,
  StatusesSchema,
  TaskTypesSchema,
  normalizeStatuses,
  normalizeTaskTypes,
} from '../../contracts/web-schemas/issues.ts'
import { SprintSchema } from '../../contracts/web-schemas/planning.ts'
import { coreReply } from '../contract.ts'
import type { CoreEnvironment } from '../environment.ts'
import { loadBrowserScope, publicWebFailure } from './authentication.ts'
import { authorizeDataEntity, requireDataWorkspace } from './data-context.ts'
import * as data from './issue-data.ts'
import { CoreReadServices } from './read-services.ts'
import type { RequestScope, WebRequest } from './scope.ts'

export function webRead<A, E>(
  env: CoreEnvironment,
  request: WebRequest,
  workspaceId: string,
  operation: (scope: RequestScope) => Effect.Effect<A, E, CoreReadServices>,
  projectId?: string,
) {
  return Effect.gen(function* () {
    const base = yield* loadBrowserScope(env, request, { workspaceHint: '', projectHint: projectId ?? '' })
    const workspace = yield* Effect.try({ try: () => requireDataWorkspace(base, workspaceId), catch: publicWebFailure })
    const scope: RequestScope = { ...base, selection: { kind: 'workspace', workspace } }
    return yield* operation(scope).pipe(Effect.provideService(CoreReadServices, { db: env.DB }))
  }).pipe(Effect.mapError(publicWebFailure))
}

export const makeIssueReadHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => {
  const reply = function reply<S extends Schema.Top, A, E>(
    operation: string,
    schema: S,
    read: (env: CoreEnvironment) => Effect.Effect<A, E>,
  ) {
    return Effect.flatMap(envSource, (env) => coreReply(operation, schema, read(env)))
  }
  return {
    webIssue: (request: WebRequest, workspaceId: string, identifier: string, projectId?: string) =>
      reply('webIssue', IssueSchema, (env) =>
        webRead(
          env,
          request,
          workspaceId,
          (scope) => data.readDataIssue(scope, workspaceId, identifier, projectId),
          projectId,
        ),
      ),
    webIssuePage: (request: WebRequest, workspaceId: string, query: string) =>
      reply('webIssuePage', IssuePageSchema, (env) =>
        webRead(
          env,
          request,
          workspaceId,
          (scope) => data.readDataIssuePage(scope, workspaceId, new URLSearchParams(query)),
          new URLSearchParams(query).get('project') ?? undefined,
        ),
      ),
    webIssueSearch: (
      request: WebRequest,
      workspaceId: string,
      query: string,
      projectId?: string,
      review?: ReviewFilter,
    ) =>
      reply('webIssueSearch', SearchResultsSchema, (env) =>
        webRead(
          env,
          request,
          workspaceId,
          (scope) => data.searchDataIssues(scope, workspaceId, query, projectId, review),
          projectId,
        ),
      ),
    webIssueComments: (request: WebRequest, workspaceId: string, identifier: string, projectId?: string) =>
      reply('webIssueComments', CommentsSchema, (env) =>
        webRead(
          env,
          request,
          workspaceId,
          (scope) => data.readDataComments(scope, workspaceId, identifier, projectId),
          projectId,
        ),
      ),
    webIssueLinks: (request: WebRequest, workspaceId: string, identifier: string, projectId?: string) =>
      reply('webIssueLinks', LinksSchema, (env) =>
        webRead(
          env,
          request,
          workspaceId,
          (scope) => data.readDataLinks(scope, workspaceId, identifier, projectId),
          projectId,
        ),
      ),
    webIssueAttachments: (request: WebRequest, workspaceId: string, identifier: string, projectId?: string) =>
      reply('webIssueAttachments', AttachmentsSchema, (env) =>
        webRead(
          env,
          request,
          workspaceId,
          (scope) => data.readDataAttachments(scope, workspaceId, identifier, projectId),
          projectId,
        ),
      ),
    webWikiAttachmentSearch: (request: WebRequest, workspaceId: string, query: string) =>
      reply('webWikiAttachmentSearch', WikiSearchResultsSchema, (env) =>
        webRead(env, request, workspaceId, (scope) => data.searchDataWikiAttachments(scope, workspaceId, query)),
      ),
    webIssueLookups: (request: WebRequest, workspaceId: string) =>
      reply('webIssueLookups', Schema.Struct({ statuses: StatusesSchema, taskTypes: TaskTypesSchema }), (env) =>
        webRead(env, request, workspaceId, () =>
          Effect.all(
            {
              statuses: listTaskStatuses(env.DB, workspaceId).pipe(Effect.map(normalizeStatuses)),
              taskTypes: listTaskTypes(env.DB, workspaceId).pipe(Effect.map(normalizeTaskTypes)),
            },
            { concurrency: 2 },
          ),
        ),
      ),
    webIssueMembers: (request: WebRequest, workspaceId: string) =>
      reply('webIssueMembers', Schema.Array(MemberSchema), (env) =>
        webRead(env, request, workspaceId, () => listWorkspaceMembers(env.DB, workspaceId)),
      ),
    webSprints: (request: WebRequest, workspaceId: string, projectId: string) =>
      reply('webSprints', Schema.Array(SprintSchema), (env) =>
        webRead(env, request, workspaceId, (scope) =>
          Effect.gen(function* () {
            if (!scope.projects.some((project) => project.id === projectId && project.workspace_id === workspaceId)) {
              return yield* new ScopeError(404, 'Selected project is not accessible.')
            }
            return yield* listSprints(env.DB, workspaceId, { projectId })
          }),
        ),
      ),
    webSprint: (request: WebRequest, workspaceId: string, sprintId: string) =>
      reply('webSprint', SprintSchema, (env) =>
        webRead(env, request, workspaceId, (scope) =>
          Effect.gen(function* () {
            const sprint = yield* findSprintById(env.DB, workspaceId, sprintId)
            return yield* data.checked(() => authorizeDataEntity(scope, workspaceId, sprint))
          }),
        ),
      ),
  }
}
