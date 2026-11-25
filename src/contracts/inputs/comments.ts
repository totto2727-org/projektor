import { z } from 'zod'

import { MAX_ISSUE_COMMENT_LENGTH } from '../issue-limits.ts'
import { objectInOrder } from './common.ts'

const body = z.string().nonempty().max(MAX_ISSUE_COMMENT_LENGTH)

export const ListCommentsSchema = z.object({
  issueId: z.string(),
})

export const AddCommentSchema = objectInOrder([
  ['issueId', z.string()],
  ['body', body],
])

export const UpdateCommentSchema = objectInOrder([
  ['issueId', z.string()],
  ['commentId', z.string()],
  ['body', body],
])

export const DeleteCommentSchema = objectInOrder([
  ['issueId', z.string()],
  ['commentId', z.string()],
])
