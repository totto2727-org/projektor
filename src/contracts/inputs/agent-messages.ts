import { z } from 'zod'

import { objectInOrder } from './common.ts'

const MAX_MESSAGE_LENGTH = 5000
const MIN_PAGE_SIZE = 1
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 50

const scopeSchema = z.string().refine((scope) => scope === 'workspace' || /^issue:[0-9a-f-]{36}$/u.test(scope), {
  message: 'scope must be "workspace" or "issue:<uuid>"',
})

export const PostMessageSchema = objectInOrder([
  ['scope', scopeSchema],
  ['agentId', z.uuid().optional()],
  ['body', z.string().nonempty().max(MAX_MESSAGE_LENGTH)],
])

export const ListMessagesSchema = objectInOrder([
  ['scope', scopeSchema],
  // Opaque composite cursor: "createdAt:id" — stable across same-second inserts
  ['cursor', z.string().optional()],
  ['limit', z.coerce.number().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)],
])
