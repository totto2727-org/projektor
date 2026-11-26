import { and, asc, eq } from 'drizzle-orm'
import type { Effect } from 'effect'

import { drizzle, schema } from '#db'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'

export type Sprint = typeof schema.sprints.$inferSelect
export type ListSprintsOptions = Readonly<{ projectId: string }>

/**
 * Caller validates options and authorizes project access before executing.
 *
 * @param {D1Database} db Database that stores sprints.
 * @param {string} workspaceId Workspace that owns the project.
 * @param {ListSprintsOptions} opts Validated project selection.
 * @returns {Effect.Effect<Sprint[], DataQueryError>} An Effect that reads the project's sprints in creation order.
 */
export const listSprints = function listSprints(
  db: D1Database,
  workspaceId: string,
  opts: ListSprintsOptions,
): Effect.Effect<Sprint[], DataQueryError> {
  return queryEffect('listSprints', () =>
    drizzle(db, { schema })
      .select()
      .from(schema.sprints)
      .where(and(eq(schema.sprints.workspaceId, workspaceId), eq(schema.sprints.projectId, opts.projectId)))
      .orderBy(asc(schema.sprints.createdAt)),
  )
}

/**
 * Missing rows carry no application-level not-found semantics.
 *
 * @param {D1Database} db Database that stores sprints.
 * @param {string} workspaceId Workspace that owns the sprint.
 * @param {string} id Identifier of the sprint to find.
 * @returns {Effect.Effect<Sprint | undefined, DataQueryError>} An Effect that reads the matching sprint or undefined.
 */
export const findSprintById = function findSprintById(
  db: D1Database,
  workspaceId: string,
  id: string,
): Effect.Effect<Sprint | undefined, DataQueryError> {
  return queryEffect('findSprintById', () =>
    drizzle(db, { schema })
      .select()
      .from(schema.sprints)
      .where(and(eq(schema.sprints.id, id), eq(schema.sprints.workspaceId, workspaceId)))
      .get(),
  )
}
