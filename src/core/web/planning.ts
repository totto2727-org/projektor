import { Effect, Schema } from 'effect'

import * as sprints from '#commands/sprints'
import { getCodeHeatmap } from '#services/code-heatmap'
import { getFlowMetrics } from '#services/flow-metrics'

import { HeatmapSchema, MetricsSchema } from '../../web/features/planning/schemas'
import { requireDataProject } from '../../web/server/data-context'
import { coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { publicWebFailure } from './authentication'
import { browserCommand } from './command'
import { CommandIdSchema, CommandOkSchema, type BrowserCommand } from './command-contract'
import { webRead } from './issue-operations'
import { type WebRequest } from './scope'

export const MetricsQuerySchema = Schema.Struct({
  projectId: Schema.String,
  since: Schema.Number,
  until: Schema.Number,
  granularity: Schema.Literals(['day', 'week']),
  mode: Schema.Literals(['claims', 'contention']),
  prefix: Schema.String,
})
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
              const query = yield* Schema.decodeUnknownEffect(MetricsQuerySchema)(input)
              yield* Effect.try({
                try: () => requireDataProject(scope, query.projectId, workspaceId),
                catch: publicWebFailure,
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
              const query = yield* Schema.decodeUnknownEffect(MetricsQuerySchema)(input)
              yield* Effect.try({
                try: () => requireDataProject(scope, query.projectId, workspaceId),
                catch: publicWebFailure,
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
        browserCommand(env, proof, (ctx) => sprints.createSprint(ctx, input)),
      ),
    ),
  webDeleteSprint: (proof: BrowserCommand, id: string) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webDeleteSprint',
        CommandOkSchema,
        browserCommand(env, proof, (ctx) => sprints.deleteSprint(ctx, id)),
      ),
    ),
  webMoveSprintIssues: (proof: BrowserCommand, input: unknown) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webMoveSprintIssues',
        Schema.Struct({ ok: Schema.Boolean, count: Schema.Number }),
        browserCommand(env, proof, (ctx) => sprints.moveIssuesToSprint(ctx, input)),
      ),
    ),
})
