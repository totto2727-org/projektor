import { Effect } from 'effect'

import { getSharedIssue } from '#commands/share.ts'

import { SharedIssue } from '../../contracts/web-schemas/share.ts'
import { coreReply } from '../contract.ts'
import { publicDomainFailure } from '../domain-errors.ts'
import type { CoreEnvironment } from '../environment.ts'

export const makeShareHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  webSharedIssue: (token: string) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webSharedIssue',
        SharedIssue,
        Effect.tryPromise({ try: () => getSharedIssue(env.DB, token), catch: publicDomainFailure }),
      ),
    ),
})
