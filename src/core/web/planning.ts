import { Effect, Schema } from 'effect'

import * as sprints from '#commands/sprints.ts'
import { HTTP_BAD_REQUEST } from '#contracts/http-status.ts'
import { SECONDS_PER_DAY } from '#contracts/time.ts'
import { requireDataProject } from '#contracts/web-data.ts'
import { MAX_METRICS_DAYS } from '#contracts/web-limits.ts'
import { HeatmapSchema, MetricsSchema } from '#contracts/web-schemas/planning.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { getCodeHeatmap } from '#services/code-heatmap.ts'
import { getFlowMetrics } from '#services/flow-metrics.ts'

import { publicWebFailure } from './authentication.ts'
import { CommandIdSchema, CommandOkSchema } from './command-contract.ts'
import type { BrowserCommand } from './command-contract.ts'
import { browserCommand } from './command.ts'
import { webRead } from './issue-operations.ts'
import type { WebRequest } from './scope.ts'

export const MetricsQuerySchema = Schema.Struct({
  projectId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  since: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 253_402_300_799 })),
  until: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 253_402_300_799 })),
  granularity: Schema.Literals(['day', 'week']),
  mode: Schema.Literals(['claims', 'contention']),
  prefix: Schema.String.check(Schema.isMaxLength(2000)),
}).check(
  Schema.makeFilter(
    (query) => query.since <= query.until && query.until - query.since < MAX_METRICS_DAYS * SECONDS_PER_DAY,
  ),
)
export type MetricsQuery = typeof MetricsQuerySchema.Type

export const makePlanningHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  webFlowMetrics: (request: WebRequest, workspaceId: string, input: MetricsQuery) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webFlowMetrics',
        MetricsSchema,
        webRead(
          env,
          request,
          workspaceId,
          (scope) =>
            Effect.gen(function* () {
              const query = yield* Schema.decodeUnknownEffect(MetricsQuerySchema)(input).pipe(
                Effect.mapError(() =>
                  coreFailure(HTTP_BAD_REQUEST, `Choose a valid metrics range of at most ${MAX_METRICS_DAYS} days.`),
                ),
              )
              yield* Effect.try({
                catch: publicWebFailure,
                try: () => requireDataProject(scope, query.projectId, workspaceId),
              })
              return yield* getFlowMetrics(env.DB, workspaceId, query)
            }),
          input.projectId,
        ),
      ),
    ),
  webCodeHeatmap: (request: WebRequest, workspaceId: string, input: MetricsQuery) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webCodeHeatmap',
        HeatmapSchema,
        webRead(
          env,
          request,
          workspaceId,
          (scope) =>
            Effect.gen(function* () {
              const query = yield* Schema.decodeUnknownEffect(MetricsQuerySchema)(input).pipe(
                Effect.mapError(() =>
                  coreFailure(HTTP_BAD_REQUEST, `Choose a valid metrics range of at most ${MAX_METRICS_DAYS} days.`),
                ),
              )
              yield* Effect.try({
                catch: publicWebFailure,
                try: () => requireDataProject(scope, query.projectId, workspaceId),
              })
              return yield* getCodeHeatmap(env.DB, workspaceId, query)
            }),
          input.projectId,
        ),
      ),
    ),
  webCreateSprint: (proof: BrowserCommand, input: unknown) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webCreateSprint',
        CommandIdSchema,
        browserCommand(env, proof, async (ctx) => sprints.createSprint(ctx, input)),
      ),
    ),
  webDeleteSprint: (proof: BrowserCommand, id: string) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webDeleteSprint',
        CommandOkSchema,
        browserCommand(env, proof, async (ctx) => sprints.deleteSprint(ctx, id)),
      ),
    ),
  webMoveSprintIssues: (proof: BrowserCommand, input: unknown) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webMoveSprintIssues',
        Schema.Struct({ ok: Schema.Boolean, count: Schema.Number }),
        browserCommand(env, proof, async (ctx) => sprints.moveIssuesToSprint(ctx, input)),
      ),
    ),
})
