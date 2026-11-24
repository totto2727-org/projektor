import {
  createFeedbackSource,
  getFeedbackSource,
  listFeedbackSources,
  revokeFeedbackSource,
  rotateFeedbackSourceToken,
  updateFeedbackSource,
} from '#api/services/feedback-sources.ts'
import { convertFeedbackToIssue, listFeedback, updateFeedbackStatus } from '#api/services/feedback.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, PLAIN_WRITE, READ } from './annotations.ts'
import { requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const feedbackTools: MCPTool[] = [
  {
    annotations: CREATE,
    description:
      'Create a feedback source for a project. A source is a named, independently-credentialed ' +
      "feedback collection point (e.g. 'Onboarding survey', 'In-app NPS widget') that end-user " +
      "feedback is submitted against. Returns a raw token that must be embedded in the user's own " +
      'product code (a form or widget that POSTs to /api/feedback/submit with ' +
      "'Authorization: Bearer <token>'). The raw token is shown exactly once and cannot be " +
      'retrieved later — relay it to the user immediately. Admin/owner only. Optionally restrict ' +
      'browser callers with allowedOrigins (a list of allowed CORS origins); omit it for ' +
      'server-to-server callers.',
    async handler(input, ctx) {
      return createFeedbackSource(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId', 'name'], {
      projectId: describedInputProperty('string', 'UUID of the project this source belongs to'),
      name: { type: 'string', minLength: 1, maxLength: 100 },
      description: { type: 'string', maxLength: 500 },
      allowedOrigins: {
        type: 'array',
        items: { type: 'string', maxLength: 2000 },
        description: 'Allowed CORS origins for browser submission; omit for no restriction',
      },
    }),
    name: 'create_feedback_source',
  },
  {
    annotations: READ,
    description:
      "List a project's feedback sources. Each entry includes id, name, description, whether " +
      'it is active, its allowed origins, a truncated token preview (never the raw token), and ' +
      'created/revoked timestamps. Admin/owner only.',
    async handler(input, ctx) {
      return listFeedbackSources(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId'], { projectId: { type: 'string' } }),
    name: 'list_feedback_sources',
  },
  {
    annotations: READ,
    description:
      'Look up a single feedback source by id, including its projectId. Workspace-scoped: a ' +
      'sourceId from another workspace 404s. Any workspace member can read.',
    async handler(input, ctx) {
      return getFeedbackSource(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['sourceId'], { sourceId: { type: 'string' } }),
    name: 'get_feedback_source',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description:
      "Update a feedback source's name, description, or active state. Setting isActive to false " +
      "is a kill switch: submissions against the source's token are immediately rejected (this is " +
      'reversible — set it back to true to resume; contrast with revoke_feedback_source, which is ' +
      'permanent). Admin/owner only.',
    async handler(input, ctx) {
      return updateFeedbackSource(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['sourceId'], {
      sourceId: { type: 'string' },
      name: { type: 'string', minLength: 1, maxLength: 100 },
      description: { type: 'string', maxLength: 500 },
      isActive: { type: 'boolean' },
    }),
    name: 'update_feedback_source',
  },
  {
    annotations: DESTRUCTIVE,
    description:
      'Generate a new token for a feedback source. Returns the new raw token once; the old token ' +
      "stops working immediately. The source's identity (id), name, description, and all its " +
      'historical feedback are preserved — use this when a token has leaked or needs periodic ' +
      'rotation. Relay the new token to the user so they can update their product code. Admin/owner only.',
    async handler(input, ctx) {
      return rotateFeedbackSourceToken(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['sourceId'], { sourceId: { type: 'string' } }),
    name: 'rotate_feedback_source_token',
  },
  {
    annotations: DESTRUCTIVE,
    description:
      'Permanently revoke a feedback source. Its token stops working for good and it can never ' +
      'accept another submission (its historical feedback is retained for reference). To replace ' +
      'a revoked source, create a new one. Admin/owner only.',
    async handler(input, ctx) {
      return revokeFeedbackSource(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['sourceId'], { sourceId: { type: 'string' } }),
    name: 'revoke_feedback_source',
  },
  {
    annotations: READ,
    description:
      "List a project's submitted feedback (read/triage, not source management). Each entry " +
      'includes rating, ratingScale, body, submitterLabel, sourceUrl, appVersion, status ' +
      "('new'/'reviewed'/'actioned'), linkedIssueId (set once converted to an issue), and " +
      'createdAt. Optionally filter by status or sourceId. Any project member (including ' +
      'viewer) can read.',
    async handler(input, ctx) {
      return listFeedback(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId'], {
      projectId: { type: 'string' },
      status: { type: 'string', enum: ['new', 'reviewed', 'actioned'] },
      sourceId: { type: 'string' },
    }),
    name: 'list_feedback',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: "Update a feedback item's triage status ('new'/'reviewed'/'actioned'). Member+ (not viewer).",
    async handler(input, ctx) {
      return updateFeedbackStatus(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['feedbackId', 'status'], {
      feedbackId: { type: 'string' },
      status: { type: 'string', enum: ['new', 'reviewed', 'actioned'] },
    }),
    name: 'update_feedback_status',
  },
  {
    annotations: PLAIN_WRITE,
    description:
      'Convert a feedback item into a tracked issue. The issue title comes from the feedback ' +
      "body (or a rating-based fallback when there's no body); the feedback item is stamped " +
      "linkedIssueId and its status set to 'actioned'. Rejects (409) if the item was already " +
      'converted. Member+ (not viewer).',
    async handler(input, ctx) {
      return convertFeedbackToIssue(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['feedbackId'], { feedbackId: { type: 'string' } }),
    name: 'convert_feedback_to_issue',
  },
]
