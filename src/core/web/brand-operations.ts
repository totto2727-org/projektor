import { Effect } from 'effect'

import { getWorkspaceBrandForShare } from '#commands/workspaces'

import { WorkspaceBrand } from '../../contracts/web-brand'
import { coreFailure, coreReply } from '../contract'
import type { CoreEnvironment } from '../environment'
import { loadBrowserScope } from './authentication'
import type { WebRequest } from './scope'

export const makeBrandHandlers = <R>(envSource: Effect.Effect<CoreEnvironment, never, R>) => ({
  browserWorkspaceBrand: (request: WebRequest, workspaceSlug: string) =>
    coreReply(
      'browserWorkspaceBrand',
      WorkspaceBrand,
      Effect.gen(function* () {
        const env = yield* envSource
        const scope = yield* loadBrowserScope(env, request, {
          workspaceHint: workspaceSlug,
          projectHint: '',
          requireWorkspace: true,
        })
        if (scope.selection.kind !== 'workspace' && scope.selection.kind !== 'project')
          return yield* coreFailure(403, 'Selected workspace is not accessible.')
        const workspace = scope.selection.workspace
        return yield* Effect.tryPromise(() => getWorkspaceBrandForShare(env.DB, workspace.id, workspace.slug))
      }),
    ),
})
