import { Effect } from 'effect'

import { coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { loadBrowserScope } from './authentication'
import { makeIssueReadHandlers } from './issue-operations'
import { RequestScopeSchema, type ScopeOptions, type WebRequest } from './scope'

export const makeWebCoreHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  ...makeIssueReadHandlers(envSource),
  browserScope: (request: WebRequest, options: ScopeOptions = {}) =>
    Effect.flatMap(envSource, (env) =>
      coreReply('browserScope', RequestScopeSchema, loadBrowserScope(env, request, options)),
    ),
})

export type WebCoreRpcShape = ReturnType<typeof makeWebCoreHandlers<never>>
