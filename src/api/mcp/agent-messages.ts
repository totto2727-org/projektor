import { listMessages, postMessage } from '#api/services/agent-messages.ts'

import { PLAIN_WRITE, READ } from './annotations.ts'
import { requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const agentMessagesTools: MCPTool[] = [
  {
    annotations: PLAIN_WRITE,
    description: 'Post a coordination message to a workspace or issue channel so the agent fleet can communicate',
    handler(input, ctx) {
      return postMessage(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['scope', 'body'], {
      scope: describedInputProperty(
        'string',
        'Channel scope: "workspace" for the workspace-wide channel, or "issue:<uuid>" for an issue channel',
      ),
      agentId: describedInputProperty('string', 'Agent session UUID posting the message (optional)'),
      body: describedInputProperty('string', 'Message body (1–5000 characters)'),
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
      scope: describedInputProperty('string', 'Channel scope: "workspace" or "issue:<uuid>"'),
      cursor: describedInputProperty('string', "Pagination cursor: pass the previous page's `nextCursor` unchanged"),
      limit: describedInputProperty('number', 'Max messages to return (1–100, default 50)'),
    }),
    name: 'list_messages',
  },
]
