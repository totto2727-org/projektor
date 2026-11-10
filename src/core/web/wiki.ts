import { Effect } from 'effect'

import { WikiSeedDataSchema } from '../../web/features/wiki/schemas'
import { coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { webRead } from './issue-operations'
import type { WebRequest } from './scope'
import { loadWikiData } from './wiki-data'

export const makeWikiHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
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
            const project = projectId
              ? scope.projects.find((item) => item.id === projectId && item.workspace_id === workspaceId)
              : undefined
            const workspace = scope.workspaces.find((item) => item.id === workspaceId)!
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
