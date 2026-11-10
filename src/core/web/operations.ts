import { coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { loadBrowserScope } from './authentication'
import { RequestScopeSchema, type ScopeOptions, type WebRequest } from './scope'

export const makeWebCoreHandlers = (env: CoreEnvironment) => ({
  browserScope: (request: WebRequest, options: ScopeOptions = {}) =>
    coreReply('browserScope', RequestScopeSchema, loadBrowserScope(env, request, options)),
})

export type WebCoreRpcShape = ReturnType<typeof makeWebCoreHandlers>
