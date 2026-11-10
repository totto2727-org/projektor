import { Effect, Schema } from 'effect'

import { CommandIdSchema, CommandOkSchema } from '../../../core/web/command-contract'
import type { MetricsQuery } from '../../../core/web/planning'
import { browserRequest, coreResult } from '../../core'
import { RequestServices } from '../../request'
import type { BrowserCommandClient } from '../../server/browser-command'
import { sprints } from '../issues/commands'
import { HeatmapSchema, MetricsSchema } from './schemas'

export const sprintCommands = {
  ...sprints,
  createSprint: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(CommandIdSchema, core.webCreateSprint(proof, input)),
  deleteSprint: ({ core, proof }: BrowserCommandClient, id: string) =>
    coreResult(CommandOkSchema, core.webDeleteSprint(proof, id)),
  moveIssuesToSprint: ({ core, proof }: BrowserCommandClient, input: unknown) =>
    coreResult(Schema.Struct({ ok: Schema.Boolean, count: Schema.Number }), core.webMoveSprintIssues(proof, input)),
}
export function readFlowMetrics(workspaceId: string, query: MetricsQuery) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      MetricsSchema,
      services.core.webFlowMetrics(browserRequest(services.request), workspaceId, query),
    )
  })
}
export function readCodeHeatmap(workspaceId: string, query: MetricsQuery) {
  return Effect.gen(function* () {
    const services = yield* RequestServices
    return yield* coreResult(
      HeatmapSchema,
      services.core.webCodeHeatmap(browserRequest(services.request), workspaceId, query),
    )
  })
}
