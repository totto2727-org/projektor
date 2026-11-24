import { listMessages, postMessage } from '#api/services/agent-messages.ts'

import { PLAIN_WRITE, READ } from './annotations.ts'
import { requiredObjectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const agentMessagesTools: MCPTool[] = [
  {
    annotations: PLAIN_WRITE,
    description: 'Post a coordination message to a workspace or issue channel so the agent fleet can communicate',
    handler(input, ctx) {
      return postMessage(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['scope', 'body'], {
      scope: {
        type: 'string',
        description:
          'Channel scope: "workspace" for the workspace-wide channel, or "issue:<uuid>" for an issue channel',
      },
      agentId: {
        type: 'string',
        description: 'Agent session UUID posting the message (optional)',
      },
      body: { type: 'string', description: 'Message body (1–5000 characters)' },
    }),
    name: 'post_message',
  },
  {
    annotations: READ,
    description: 'List coordination messages for a workspace or issue channel, in chronological order',
    handler(input, ctx) {
      return listMessages(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['scope'], {
      scope: {
        type: 'string',
        description: 'Channel scope: "workspace" or "issue:<uuid>"',
      },
      cursor: {
        type: 'string',
        description: "Pagination cursor: pass the previous page's `nextCursor` unchanged",
      },
      limit: { type: 'number', description: 'Max messages to return (1–100, default 50)' },
    }),
    name: 'list_messages',
  },
]
