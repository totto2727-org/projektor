import { Effect } from 'effect'

import { getSharedIssue } from '#commands/share.ts'
import { SharedIssue } from '#contracts/web-schemas/share.ts'
import { coreReply } from '#core/contract.ts'
import { publicDomainFailure } from '#core/domain-errors.ts'
import type { CoreEnvironment } from '#core/environment.ts'

export const makeShareHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  webSharedIssue: (token: string) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webSharedIssue',
        SharedIssue,
        Effect.tryPromise({ catch: publicDomainFailure, try: async () => getSharedIssue(env.DB, token) }),
      ),
    ),
})
