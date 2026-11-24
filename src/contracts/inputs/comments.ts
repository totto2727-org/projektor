import { z } from 'zod'

const MAX_COMMENT_LENGTH = 10_000

const body = z.string().nonempty().max(MAX_COMMENT_LENGTH)

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
