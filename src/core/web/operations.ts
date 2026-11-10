import { Effect } from 'effect'

import { coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { loadBrowserScope } from './authentication'
import { makeIssueCommandHandlers } from './issue-commands'
import { makeIssueReadHandlers } from './issue-operations'
import { makePlanningHandlers } from './planning'
import { makeProjectHandlers } from './projects'
import { RequestScopeSchema, type ScopeOptions, type WebRequest } from './scope'
import { makeWikiHandlers } from './wiki'
import { makeWikiCommandHandlers } from './wiki-commands'

export const makeWebCoreHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  ...makeIssueReadHandlers(envSource),
  ...makeIssueCommandHandlers(envSource),
  ...makePlanningHandlers(envSource),
  ...makeProjectHandlers(envSource),
  ...makeWikiHandlers(envSource),
  ...makeWikiCommandHandlers(envSource),
  browserScope: (request: WebRequest, options: ScopeOptions = {}) =>
    Effect.flatMap(envSource, (env) =>
      coreReply('browserScope', RequestScopeSchema, loadBrowserScope(env, request, options)),
    ),
})

export type WebCoreRpcShape = ReturnType<typeof makeWebCoreHandlers<never>>
