import { and, asc, eq } from 'drizzle-orm'

import { drizzle, schema } from '#db'

import { queryEffect } from './errors'

export interface CommentRow {
  id: string
  body: string
  created_at: number
  updated_at: number
  author_id: string
  author_name: string
  author_email: string
}

/** Caller authorizes the issue, while this query independently enforces tenant scope. */
export function listComments(db: D1Database, workspaceId: string, issueId: string) {
  return queryEffect('listComments', async (): Promise<CommentRow[]> => {
    const orm = drizzle(db, { schema })
    return orm
      .select({
        id: schema.issueComments.id,
        body: schema.issueComments.body,
        created_at: schema.issueComments.createdAt,
        updated_at: schema.issueComments.updatedAt,
        author_id: schema.users.id,
        author_name: schema.users.name,
        author_email: schema.users.email,
      })
      .from(schema.issueComments)
      .innerJoin(schema.users, eq(schema.issueComments.authorId, schema.users.id))
      .innerJoin(schema.issues, eq(schema.issueComments.issueId, schema.issues.id))
      .where(and(eq(schema.issueComments.issueId, issueId), eq(schema.issues.workspaceId, workspaceId)))
      .orderBy(asc(schema.issueComments.createdAt))
  })
}
