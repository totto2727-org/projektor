import { flattenError } from 'zod'
import type { output } from 'zod'

import { SubmitFeedbackSchema } from '#contracts/inputs/feedback.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'

import { ValidationError } from './errors.ts'

type FeedbackSubmission = output<typeof SubmitFeedbackSchema>

export interface FeedbackSubmissionSource {
  id: string
  workspace_id: string
  project_id: string
}

export const parseSubmitFeedbackBody = function parseSubmitFeedbackBody(rawBody: unknown): FeedbackSubmission {
  const parsed = SubmitFeedbackSchema.safeParse(rawBody)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }
  return parsed.data
}

export const insertFeedbackRow = async function insertFeedbackRow(
  db: D1Database,
  source: FeedbackSubmissionSource,
  input: FeedbackSubmission,
): Promise<string> {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await db
    .prepare(
      `INSERT INTO feedback
       (id, source_id, workspace_id, project_id, rating, rating_scale, body, submitter_label,
        source_url, app_version, status, linked_issue_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?)`,
    )
    .bind(
      id,
      source.id,
      source.workspace_id,
      source.project_id,
      input.rating ?? SQL_NULL,
      input.ratingScale ?? SQL_NULL,
      input.body ?? SQL_NULL,
      input.submitterLabel ?? SQL_NULL,
      input.sourceUrl ?? SQL_NULL,
      input.appVersion ?? SQL_NULL,
      now,
    )
    .run()
  return id
}
