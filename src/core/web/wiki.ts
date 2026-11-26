import { String, Predicate, Effect } from 'effect'

import { WikiSeedDataSchema } from '#contracts/web-schemas/wiki.ts'
import { coreReply } from '#core/contract.ts'
import type { CoreReply } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import { webRead } from './issue-operations.ts'
import type { WebRequest } from './scope.ts'
import { loadWikiData } from './wiki-data.ts'

type WikiSeedArguments = [request: WebRequest, workspaceId: string, url: string, slug?: string, projectId?: string]

interface WikiHandlers<R> {
  webWikiSeed: (...args: WikiSeedArguments) => CoreReply<R, typeof WikiSeedDataSchema>
}

export const makeWikiHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>): WikiHandlers<R> => ({
  webWikiSeed: (request: WebRequest, workspaceId: string, url: string, slug?: string, projectId?: string) =>
    Effect.flatMap(envSource, (env) =>
      coreReply(
        'webWikiSeed',
        WikiSeedDataSchema,
        webRead(
          env,
          request,
          workspaceId,
          (scope) => {
            const project =
              Predicate.isNotNullish(projectId) && String.isNonEmpty(projectId)
                ? scope.projects.find((item) => item.id === projectId && item.workspace_id === workspaceId)
                : undefined
            const { workspace } = scope.selection
            return loadWikiData(
              env,
              project ? { ...scope, selection: { kind: 'project', project, workspace } } : scope,
              new URL(url),
              { slug },
            )
          },
          projectId,
        ),
      ),
    ),
})
