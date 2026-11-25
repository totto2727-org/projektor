import { and, asc, eq } from 'drizzle-orm'
import type { Effect } from 'effect'

import { drizzle, schema } from '#db'

import { queryEffect } from './errors.ts'
import type { DataQueryError } from './errors.ts'

export type Sprint = typeof schema.sprints.$inferSelect
export type ListSprintsOptions = Readonly<{ projectId: string }>

/** Caller validates options and authorizes project access before executing. */
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

/** Missing rows carry no application-level not-found semantics. */
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
