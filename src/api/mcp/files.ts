import { REVIEW_STATUSES } from '../../contracts/review-targets'
import {
  createLinkAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments,
  setAttachmentReviewStatus,
} from '../services/files'
import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations'
import type { MCPTool } from './types'

// Binary upload and streamed download can't cross JSON-RPC, so those two operations
// stay REST-only (POST /api/files, GET /api/files/:id) — a deliberate parity exception
// (AGENTS.md). Everything else, including review-status updates, is metadata-only
// and gets full MCP parity here (PROJ-234).
export const filesTools: MCPTool[] = [
  {
    name: 'set_attachment_review_status',
    description:
      'Select or update an issue-owned file or URL review target. Set status to null to remove it from review targets. Wiki references are not eligible.',
    inputSchema: {
      type: 'object',
      required: ['issueId', 'attachmentId', 'status'],
      properties: {
        issueId: { type: 'string' },
        attachmentId: { type: 'string' },
        status: { type: ['string', 'null'], enum: [...REVIEW_STATUSES, null] },
      },
    },
    annotations: IDEMPOTENT_WRITE,
    async handler(input, ctx) {
      return await setAttachmentReviewStatus(ctx, input)
    },
  },
  {
    name: 'list_attachments',
    description: 'List attachments (files, wiki-page links, URLs) on an issue or wiki page',
    inputSchema: {
      type: 'object',
      required: ['entityType', 'entityId'],
      properties: {
        entityType: { type: 'string', enum: ['issue', 'wiki_page'] },
        entityId: { type: 'string' },
      },
    },
    annotations: READ,
    async handler(input, ctx) {
      return listAttachments(ctx, input)
    },
  },
  {
    name: 'get_attachment',
    description:
      "Get attachment metadata by id. For kind 'file' the bytes themselves are only " +
      "available over REST (GET /api/files/:id) — binary content can't cross JSON-RPC.",
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    annotations: READ,
    async handler(input, ctx) {
      return getAttachment(ctx, input)
    },
  },
  {
    name: 'create_link_attachment',
    description: 'Attach a wiki-page reference or an external URL to an issue or wiki page',
    inputSchema: {
      type: 'object',
      required: ['kind', 'entityType', 'entityId'],
      properties: {
        kind: { type: 'string', enum: ['wiki_ref', 'url'] },
        entityType: { type: 'string', enum: ['issue', 'wiki_page'] },
        entityId: { type: 'string' },
        wikiPageId: { type: 'string', description: "Required when kind is 'wiki_ref'" },
        url: { type: 'string', description: "Required when kind is 'url'" },
        label: { type: 'string', description: "Optional display label when kind is 'url'" },
      },
    },
    annotations: CREATE,
    async handler(input, ctx) {
      return await createLinkAttachment(ctx, input)
    },
  },
  {
    name: 'delete_attachment',
    description: 'Delete an attachment by id',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    annotations: DESTRUCTIVE,
    async handler(input, ctx) {
      await deleteAttachment(ctx, input)
      return { ok: true }
    },
  },
]
