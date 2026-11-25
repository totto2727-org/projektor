import { z } from 'zod'

import { MAX_ISSUE_COMMENT_LENGTH } from '../issue-limits.ts'

const body = z.string().nonempty().max(MAX_ISSUE_COMMENT_LENGTH)

export const ListCommentsSchema = z.object({
  issueId: z.string(),
})

export const AddCommentSchema = z.object({
  issueId: z.string(),
  body,
})

export const UpdateCommentSchema = z.object({
  issueId: z.string(),
  commentId: z.string(),
  body,
})

export const DeleteCommentSchema = z.object({
  issueId: z.string(),
  commentId: z.string(),
})
