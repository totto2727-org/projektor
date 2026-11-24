import { and, desc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import * as commands from '#commands/projects.ts'
import { drizzle, schema } from '#db'
import { queryEffect } from '#services/errors.ts'
import { getFlowMetrics } from '#services/flow-metrics.ts'
import { findProjectById, listProjectSummaries } from '#services/projects.ts'
import { listWikiPages } from '#services/wiki.ts'

import {
  CreatedProjectSchema,
  ProjectMutationResultSchema,
  ProjectOverviewSchema,
  ProjectSummariesSchema,
} from '../../contracts/web-schemas/projects.ts'
import { coreFailure, coreReply } from '../contract.ts'
import type { CoreEnvironment } from '../environment.ts'
import { loadBrowserScope } from './authentication.ts'
import type { BrowserCommand } from './command-contract.ts'
import { browserCommand } from './command.ts'
import { requireDataProject, projectSummaryVisibility, visibleProjectPredicate } from './data-context.ts'
import { checked } from './issue-data.ts'
import { webRead } from './issue-operations.ts'
import type { WebRequest } from './scope.ts'

const sixWeekRange = function sixWeekRange(now = new Date()) {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 35)
  return {
    since: Math.floor(monday.getTime() / 1000),
    until: Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000) + 86_399,
  }
}

export const makeProjectHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  webProjectCatalog: (request: WebRequest, includeArchived: boolean) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webProjectCatalog',
        ProjectSummariesSchema,
        Effect.gen(function* () {
          const scope = yield* loadBrowserScope(env, request, { workspaceHint: '', projectHint: '' })
          return yield* listProjectSummaries(
            env.DB,
            scope.user.id,
            projectSummaryVisibility(scope.user.id),
            includeArchived,
          )
        }),
      ),
    ),
  webProjectOverview: (request: WebRequest, workspaceId: string, projectId: string) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webProjectOverview',
        ProjectOverviewSchema,
        webRead(
          env,
          request,
          workspaceId,
          (scope) =>
            Effect.gen(function* () {
              yield* checked(() => requireDataProject(scope, projectId, workspaceId))
              const project = yield* findProjectById(env.DB, workspaceId, projectId)
              if (!project) {
                return yield* coreFailure(404, 'Selected project is not accessible.')
              }
              const orm = drizzle(env.DB, { schema })
              const [issues, wiki, flow] = yield* Effect.all(
                [
                  queryEffect('recently-updated-project-issues', () =>
                    orm
                      .select({
                        id: schema.issues.id,
                        number: schema.issues.number,
                        title: schema.issues.title,
                        project_key: schema.projects.key,
                        status_name: schema.taskStatuses.name,
                        status_key: schema.taskStatuses.key,
                        status_category: schema.taskStatuses.category,
                        updated_at: schema.issues.updatedAt,
                      })
                      .from(schema.issues)
                      .leftJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
                      .leftJoin(schema.taskStatuses, eq(schema.issues.statusId, schema.taskStatuses.id))
                      .where(
                        and(
                          eq(schema.issues.workspaceId, workspaceId),
                          eq(schema.issues.projectId, projectId),
                          visibleProjectPredicate(scope, workspaceId, schema.issues.projectId),
                        ),
                      )
                      .orderBy(desc(schema.issues.updatedAt), desc(schema.issues.id))
                      .limit(5)
                      .all(),
                  ),
                  listWikiPages(env.DB, workspaceId, {
                    projectId,
                    visibility: visibleProjectPredicate(scope, workspaceId, sql`wiki_pages.project_id`),
                  }).pipe(
                    Effect.map((pages) =>
                      [...pages]
                        .sort((left, right) => right.updated_at - left.updated_at || right.id.localeCompare(left.id))
                        .slice(0, 5),
                    ),
                  ),
                  getFlowMetrics(env.DB, workspaceId, { projectId, ...sixWeekRange(), granularity: 'week' }),
                ],
                { concurrency: 3 },
              )
              return { project, issues, wiki, flow }
            }),
          projectId,
        ),
      ),
    ),
  webCreateProject: (proof: BrowserCommand, input: unknown) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webCreateProject',
        CreatedProjectSchema,
        browserCommand(env, proof, (ctx) => commands.createProject(ctx, input)),
      ),
    ),
  webUpdateProject: (proof: BrowserCommand, id: string, input: unknown) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webUpdateProject',
        ProjectMutationResultSchema,
        browserCommand(env, proof, (ctx) => commands.updateProject(ctx, id, input)),
      ),
    ),
})
