import {
  createLinkAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments,
  setAttachmentReviewStatus,
} from '#api/services/files.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { REVIEW_STATUSES } from '#contracts/review-targets.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

/*
 * Binary upload and streamed download can't cross JSON-RPC, so those two operations
 * stay REST-only (POST /api/files, GET /api/files/:id) — a deliberate parity exception
 * (AGENTS.md). Everything else, including review-status updates, is metadata-only
 * and gets full MCP parity here (PROJ-234).
 */
export const filesTools: MCPTool[] = [
  {
    annotations: IDEMPOTENT_WRITE,
    description:
      'Select or update an issue-owned file or URL review target. Set status to null to remove it from review targets. Wiki references are not eligible.',
    async handler(input, ctx) {
      return await setAttachmentReviewStatus(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(
      ['issueId', 'attachmentId', 'status'],
      fieldsInOrder([
        ['issueId', { type: 'string' }],
        ['attachmentId', { type: 'string' }],
        [
          'status',
          fieldsInOrder([
            ['type', ['string', 'null']],
            ['enum', [...REVIEW_STATUSES, null]],
          ]),
        ],
      ]),
    ),
    name: 'set_attachment_review_status',
  },
  {
    annotations: READ,
    description: 'List attachments (files, wiki-page links, URLs) on an issue or wiki page',
    async handler(input, ctx) {
      return listAttachments(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(
      ['entityType', 'entityId'],
      fieldsInOrder([
        [
          'entityType',
          fieldsInOrder([
            ['type', 'string'],
            ['enum', ['issue', 'wiki_page']],
          ]),
        ],
        ['entityId', { type: 'string' }],
      ]),
    ),
    name: 'list_attachments',
  },
  {
    annotations: READ,
    description:
      "Get attachment metadata by id. For kind 'file' the bytes themselves are only " +
      "available over REST (GET /api/files/:id) — binary content can't cross JSON-RPC.",
    async handler(input, ctx) {
      return getAttachment(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['id'], { id: { type: 'string' } }),
    name: 'get_attachment',
  },
  {
    annotations: CREATE,
    description: 'Attach a wiki-page reference or an external URL to an issue or wiki page',
    async handler(input, ctx) {
      return await createLinkAttachment(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(
      ['kind', 'entityType', 'entityId'],
      fieldsInOrder([
        [
          'kind',
          fieldsInOrder([
            ['type', 'string'],
            ['enum', ['wiki_ref', 'url']],
          ]),
        ],
        [
          'entityType',
          fieldsInOrder([
            ['type', 'string'],
            ['enum', ['issue', 'wiki_page']],
          ]),
        ],
        ['entityId', { type: 'string' }],
        ['wikiPageId', describedInputProperty('string', "Required when kind is 'wiki_ref'")],
        ['url', describedInputProperty('string', "Required when kind is 'url'")],
        ['label', describedInputProperty('string', "Optional display label when kind is 'url'")],
      ]),
    ),
    name: 'create_link_attachment',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete an attachment by id',
    async handler(input, ctx) {
      await deleteAttachment(ctx, input)
      return { ok: true }
    },
    inputSchema: requiredObjectInputSchema(['id'], { id: { type: 'string' } }),
    name: 'delete_attachment',
  },
]
