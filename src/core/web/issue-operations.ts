import { Effect, Schema } from 'effect'

import { findSprintById, listSprints } from '#services/sprints'
import { listTaskStatuses } from '#services/task-statuses'
import { listTaskTypes } from '#services/task-types'
import { listWorkspaceMembers } from '#services/workspaces'

import { ScopeError } from '../../contracts/errors'
import { SearchResultsSchema, WikiSearchResultsSchema } from '../../contracts/web-schemas/issue-actions'
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
} from '../../contracts/web-schemas/issues'
import { SprintSchema } from '../../contracts/web-schemas/planning'
import { coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { loadBrowserScope, publicWebFailure } from './authentication'
import { authorizeDataEntity, requireDataWorkspace } from './data-context'
import * as data from './issue-data'
import { CoreReadServices } from './read-services'
import type { RequestScope, WebRequest } from './scope'

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
  function reply<S extends Schema.Top, A, E>(
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
        webRead(env, request, workspaceId, (scope) =>
          data.readDataIssuePage(scope, workspaceId, new URLSearchParams(query)),
        ),
      ),
    webIssueSearch: (request: WebRequest, workspaceId: string, query: string, projectId?: string) =>
      reply('webIssueSearch', SearchResultsSchema, (env) =>
        webRead(
          env,
          request,
          workspaceId,
          (scope) => data.searchDataIssues(scope, workspaceId, query, projectId),
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
            if (!scope.projects.some((project) => project.id === projectId && project.workspace_id === workspaceId))
              return yield* new ScopeError(404, 'Selected project is not accessible.')
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
