import { addComment, deleteComment, listComments, updateComment } from '#api/services/comments.ts'

import { DESTRUCTIVE, IDEMPOTENT_WRITE, PLAIN_WRITE, READ } from './annotations.ts'
import { requiredObjectInputSchema } from './input-schema.ts'
import { toPage } from './serialize.ts'
import type { MCPTool } from './types.ts'

export const commentsTools: MCPTool[] = [
  {
    name: 'list_comments',
    description: 'List comments on an issue. Returns `{items}` (see /projektor/agents/response-conventions/).',
    inputSchema: requiredObjectInputSchema(['issueId'], { issueId: { type: 'string' } }),
    annotations: READ,
    async handler(input, ctx) {
      return toPage(await listComments(ctx, input))
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to an issue',
    inputSchema: requiredObjectInputSchema(['issueId', 'body'], {
      issueId: { type: 'string' },
      body: { type: 'string', minLength: 1, maxLength: 10_000 },
    }),
    annotations: PLAIN_WRITE,
    async handler(input, ctx) {
      return addComment(ctx, input)
    },
  },
  {
    name: 'update_comment',
    description: 'Update the body of a comment (author only)',
    inputSchema: requiredObjectInputSchema(['issueId', 'commentId', 'body'], {
      issueId: { type: 'string' },
      commentId: { type: 'string' },
      body: { type: 'string', minLength: 1, maxLength: 10_000 },
    }),
    annotations: IDEMPOTENT_WRITE,
    async handler(input, ctx) {
      return updateComment(ctx, input)
    },
  },
  {
    name: 'delete_comment',
    description: 'Delete a comment (author, admin, or owner)',
    inputSchema: requiredObjectInputSchema(['issueId', 'commentId'], {
      issueId: { type: 'string' },
      commentId: { type: 'string' },
    }),
    annotations: DESTRUCTIVE,
    async handler(input, ctx) {
      return deleteComment(ctx, input)
    },
  },
]
