import { Effect } from 'effect'

import { getSharedIssue } from '#commands/share'

import { SharedIssue } from '../../contracts/web-schemas/share'
import { coreReply } from '../contract'
import { publicDomainFailure } from '../domain-errors'
import type { CoreEnvironment } from '../environment'

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
