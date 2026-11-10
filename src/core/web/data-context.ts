import type { D1Database } from '@cloudflare/workers-types'
import { type Column, type SQL, sql } from 'drizzle-orm'

import type { ProjectSummaryVisibility } from '#services'

import { ApiError } from '../../contracts/errors'
import { requireDataWorkspace } from '../../contracts/web-data'
import type { RequestScope } from './scope'

export {
  authorizeDataEntity,
  dataError,
  requireAuthenticatedDataSession,
  requireBrowserDataRequest,
  requireDataProject,
  requireDataWorkspace,
} from '../../contracts/web-data'

export function projectSummaryVisibility(userId: string): ProjectSummaryVisibility {
  return {
    sql: `wm.role IN ('owner','admin') OR EXISTS (
      SELECT 1 FROM user_group_members ugm
      JOIN group_project_grants gpg ON gpg.group_id = ugm.group_id
      WHERE ugm.user_id = ? AND gpg.project_id = p.id)`,
    bindings: [userId],
  }
}

export function requireDataDatabase(db: D1Database): D1Database {
  if (!db || typeof db.prepare !== 'function') {
    throw new ApiError('configuration', 500, 'The application database is not configured.')
  }
  return db
}

export function visibleProjectPredicate(
  scope: RequestScope,
  workspaceId: string,
  projectColumn: Column | SQL,
): SQL | undefined {
  const workspace = requireDataWorkspace(scope, workspaceId)
  if (workspace.role === 'owner' || workspace.role === 'admin') return undefined
  return sql`EXISTS (
    SELECT 1 FROM user_group_members ugm
    JOIN group_project_grants gpg ON gpg.group_id = ugm.group_id
    WHERE ugm.user_id = ${scope.user.id} AND gpg.project_id = ${projectColumn}
  )`
}

export function makeDataContext(services: { readonly db: D1Database }, scope: RequestScope, workspaceId?: string) {
  const workspace = requireDataWorkspace(scope, workspaceId)
  return {
    db: requireDataDatabase(services.db),
    scope,
    workspace,
    workspaceId: workspace.id,
    userId: scope.user.id,
    visibility: (projectColumn: Column | SQL) => visibleProjectPredicate(scope, workspace.id, projectColumn),
  }
}
