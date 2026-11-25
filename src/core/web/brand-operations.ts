import { Effect } from 'effect'

import { getWorkspaceBrandForShare } from '#commands/workspaces.ts'
import { HTTP_FORBIDDEN } from '#contracts/http-status.ts'
import { WorkspaceBrand } from '#contracts/web-brand.ts'
import { coreFailure, coreReply } from '#core/contract.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import { loadBrowserScope } from './authentication.ts'
import type { WebRequest } from './scope.ts'

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
        if (scope.selection.kind !== 'workspace' && scope.selection.kind !== 'project') {
          return yield* coreFailure(HTTP_FORBIDDEN, 'Selected workspace is not accessible.')
        }
        const workspace = scope.selection.workspace
        return yield* Effect.tryPromise(async () => getWorkspaceBrandForShare(env.DB, workspace.id, workspace.slug))
      }),
    ),
})
