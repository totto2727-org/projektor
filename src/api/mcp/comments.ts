import { addComment, deleteComment, listComments, updateComment } from '#api/services/comments.ts'

import { DESTRUCTIVE, IDEMPOTENT_WRITE, PLAIN_WRITE, READ } from './annotations.ts'
import { requiredObjectInputSchema } from './input-schema.ts'
import { toPage } from './serialize.ts'
import type { MCPTool } from './types.ts'

export const commentsTools: MCPTool[] = [
  {
    annotations: READ,
    description: 'List comments on an issue. Returns `{items}` (see /projektor/agents/response-conventions/).',
    async handler(input, ctx) {
      return toPage(await listComments(ctx, input))
    },
    inputSchema: requiredObjectInputSchema(['issueId'], { issueId: { type: 'string' } }),
    name: 'list_comments',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Add a comment to an issue',
    async handler(input, ctx) {
      return addComment(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['issueId', 'body'], {
      issueId: { type: 'string' },
      body: { type: 'string', minLength: 1, maxLength: 10_000 },
    }),
    name: 'add_comment',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Update the body of a comment (author only)',
    async handler(input, ctx) {
      return updateComment(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['issueId', 'commentId', 'body'], {
      issueId: { type: 'string' },
      commentId: { type: 'string' },
      body: { type: 'string', minLength: 1, maxLength: 10_000 },
    }),
    name: 'update_comment',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete a comment (author, admin, or owner)',
    async handler(input, ctx) {
      return deleteComment(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['issueId', 'commentId'], {
      issueId: { type: 'string' },
      commentId: { type: 'string' },
    }),
    name: 'delete_comment',
  },
]
