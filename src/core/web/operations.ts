import { Effect } from 'effect'

import { coreReply } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import { loadBrowserScope } from './authentication.ts'
import { makeBrandHandlers } from './brand-operations.ts'
import { makeFeedbackHandlers } from './feedback.ts'
import { makeIssueCommandHandlers } from './issue-commands.ts'
import { makeIssueReadHandlers } from './issue-operations.ts'
import { makePlanningHandlers } from './planning.ts'
import { makeProjectHandlers } from './projects.ts'
import { RequestScopeSchema } from './scope.ts'
import type { ScopeOptions, WebRequest } from './scope.ts'
import { makeSettingsHandlers } from './settings.ts'
import { makeShareHandlers } from './share.ts'
import { makeWikiCommandHandlers } from './wiki-commands.ts'
import { makeWikiHandlers } from './wiki.ts'

export const makeWebCoreHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  ...makeBrandHandlers(envSource),
  ...makeFeedbackHandlers(envSource),
  ...makeIssueReadHandlers(envSource),
  ...makeIssueCommandHandlers(envSource),
  ...makePlanningHandlers(envSource),
  ...makeProjectHandlers(envSource),
  ...makeWikiHandlers(envSource),
  ...makeWikiCommandHandlers(envSource),
  ...makeSettingsHandlers(envSource),
  ...makeShareHandlers(envSource),
  browserScope: (request: WebRequest, options: ScopeOptions = {}) =>
    Effect.flatMap(envSource, (env) =>
      coreReply('browserScope', RequestScopeSchema, loadBrowserScope(env, request, options)),
    ),
})

export type WebCoreRpcShape = ReturnType<typeof makeWebCoreHandlers<never>>
