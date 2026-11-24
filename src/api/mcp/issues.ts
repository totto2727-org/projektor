import { String, Predicate } from 'effect'

import {
  createIssue,
  deleteIssue,
  getIssue,
  getIssuesBatch,
  getPrioritizedIssues,
  listIssues,
  searchIssues,
  updateIssue,
} from '#api/services/issues.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema } from './input-schema.ts'
import { capPage, OMISSION_NOTE, shapeIssue, splitShapeOpts, toPage, VIEW_FIELDS_PROPS } from './serialize.ts'
import type { MCPTool } from './types.ts'
import { bodyPreview, ISSUE_BODY_MAX_CHARS, LIST_BODY_MAX_CHARS, windowText } from './windowing.ts'

const BODY_CHARS_PROP = {
  bodyChars: {
    type: 'number',
    default: 0,
    description:
      `Include the first N characters of each item's body (0-${LIST_BODY_MAX_CHARS}, default 0 = ` +
      'no body); a cut body carries `bodyTruncated:true`. Read the rest with get_issue. ' +
      '`includeBody:true` still returns whole bodies.',
  },
} as const

/** Splits MCP-only `bodyChars` off the input; asks the service for bodies when it's set. */
const splitBodyChars = function splitBodyChars(rest: Record<string, unknown>): {
  rest: Record<string, unknown>
  bodyChars: number
} {
  const { bodyChars, ...others } = rest
  if (bodyChars === undefined) {
    return { rest: others, bodyChars: 0 }
  }
  if (!Number.isInteger(bodyChars) || (bodyChars as number) < 0 || (bodyChars as number) > LIST_BODY_MAX_CHARS) {
    throw new ValidationError(
      validationIssues([], { bodyChars: [`must be an integer from 0 to ${LIST_BODY_MAX_CHARS}`] }),
    )
  }
  const n = bodyChars as number
  return { rest: n > 0 ? { ...others, includeBody: true } : others, bodyChars: n }
}

const withBodyPreview = function withBodyPreview(
  item: Record<string, unknown>,
  bodyChars: number,
): Record<string, unknown> {
  if (bodyChars <= 0) {
    return item
  }
  return { ...item, ...bodyPreview(item.body, bodyChars) }
}

export const issuesTools: MCPTool[] = [
  {
    name: 'list_issues',
    description:
      'List issues in the workspace, optionally filtered by status, priority, project, or assignee. ' +
      'Items omit `body` by default — pass bodyChars:N (max 1000) for a preview, or includeBody:true for whole bodies. Pass includeRollups:true ' +
      'to attach a `rollup` (child status counts: total/byStatus/done/remaining) to each item ' +
      '(a zero rollup is omitted unless verbose:true). ' +
      OMISSION_NOTE,
    inputSchema: objectInputSchema({
      projectId: {
        type: 'string',
        description: 'UUID of the project, or a project key like PROJ',
      },
      status: {
        type: 'string',
        enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'],
      },
      statusId: { type: 'string', description: 'Filter by task status ID' },
      statusIds: {
        type: 'string',
        description: 'Comma-separated task status IDs (OR-matched)',
      },
      category: {
        type: 'string',
        enum: ['todo', 'in_progress', 'done', 'cancelled'],
        description: 'Filter by status category',
      },
      priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
      priorities: {
        type: 'string',
        description: 'Comma-separated priorities (OR-matched), e.g. urgent,high',
      },
      assignee: {
        type: 'string',
        description: 'Filter by assignee user ID, or "me" for the calling user',
      },
      parentId: {
        type: 'string',
        description: 'Filter by parent issue ID, or a ref like PROJ-42 (returns direct children only)',
      },
      noParent: {
        type: 'boolean',
        description: 'Only return issues with no parent (top-level issues)',
      },
      typeId: { type: 'string', description: 'Filter by task type ID' },
      excludeTypeIds: {
        type: 'string',
        description: 'Comma-separated task type IDs to exclude (e.g. the epic type)',
      },
      sprintId: { type: 'string', description: 'Filter by sprint ID' },
      cfKey: { type: 'string', description: 'Custom field key to filter by' },
      cfOp: {
        type: 'string',
        enum: ['eq', 'gt', 'gte', 'lt', 'lte'],
        description: 'Comparison operator for the custom field filter (requires cfKey)',
      },
      cfValue: {
        type: 'string',
        description: 'Value to compare the custom field against (requires cfKey)',
      },
      completedAfter: {
        type: 'number',
        description: 'Only issues marked completed at or after this epoch-seconds time',
      },
      completedBefore: {
        type: 'number',
        description: 'Only issues marked completed at or before this epoch-seconds time',
      },
      updatedAfter: {
        type: 'number',
        description: 'Only issues last edited at or after this epoch-seconds time',
      },
      updatedBefore: {
        type: 'number',
        description: 'Only issues last edited at or before this epoch-seconds time',
      },
      needsAudit: {
        type: 'boolean',
        description:
          'Filter to agent-initiated done-closures flagged for human audit — true for ' +
          'unverifiable evidence, false for externally-checkable evidence',
      },
      includeRollups: {
        type: 'boolean',
        description: 'Attach a `rollup` of child status counts (total/byStatus/done/remaining) to each returned item',
      },
      includeBody: {
        type: 'boolean',
        description: 'Include the `body` field on each item (omitted by default)',
      },
      cursor: {
        type: ['string', 'integer'],
        description: "Pagination cursor: pass the previous page's `next` unchanged",
      },
      limit: { type: 'number', default: 50, description: 'Max 100' },
      ...BODY_CHARS_PROP,
      ...VIEW_FIELDS_PROPS,
    }),
    annotations: READ,
    async handler(input, ctx) {
      const { rest: shapeRest, ...shape } = splitShapeOpts(input)
      const { rest, bodyChars } = splitBodyChars(shapeRest)
      const result = (await listIssues(ctx, rest)) as {
        items: Record<string, unknown>[]
        nextCursor: string | null
        total?: number
      }
      /*
       * The cursor is derived from the raw rows so a capped page can resume exactly
       * after its last kept item (PROJ-857's (created_at,id) compound cursor).
       */
      const raw = result.items
      const page = toPage(
        raw.map((i) => shapeIssue(withBodyPreview(i, bodyChars), shape)),
        result.nextCursor,
        Predicate.isNullish(result.total) ? {} : { total: result.total },
      )
      return capPage(page, {
        // oxlint-disable-next-line @typescript-eslint/restrict-template-expressions -- Preserve raw-row cursor coercion and the existing MCP cursor protocol.
        cursorOf: (index) => (raw[index] ? `${raw[index].created_at}:${raw[index].id}` : undefined),
      })
    },
  },
  {
    name: 'get_issue',
    description:
      `Get a single issue by ID or project key + number (e.g. "PROJ-42"). \`body\` is returned ` +
      `up to ${ISSUE_BODY_MAX_CHARS} chars; if it is longer the result has \`bodyTruncated:true\`, ` +
      `\`bodyTotalChars\` and \`next\` — pass \`next\` back as \`cursor\` for the rest. ${OMISSION_NOTE}`,
    inputSchema: objectInputSchema({
      id: { type: 'string' },
      ref: { type: 'string', description: 'Project key and number, e.g. PROJ-42' },
      cursor: {
        type: 'string',
        description: "Continue a long body: pass the previous result's `next` unchanged",
      },
      ...VIEW_FIELDS_PROPS,
    }),
    annotations: READ,
    async handler(input, ctx) {
      const { rest: shapeRest, ...shape } = splitShapeOpts(input)
      const { cursor, ...rest } = shapeRest as { cursor?: string } & Record<string, unknown>
      const issue = (await getIssue(ctx, rest)) as Record<string, unknown>
      const shaped = shapeIssue(issue, shape)
      if (!Predicate.isString(shaped.body)) {
        return shaped
      }
      // PROJ-892: a long body is windowed; \`next\` continues it.
      const w = windowText(shaped.body, { cursor, max: ISSUE_BODY_MAX_CHARS })
      if (!w.next && Predicate.isNullish(cursor)) {
        return shaped
      }
      return {
        ...shaped,
        body: w.text,
        bodyTotalChars: w.totalChars,
        ...(w.next ? { bodyTruncated: true, next: w.next } : {}),
      }
    },
  },
  {
    name: 'get_issues',
    description:
      'Fetch up to 50 issues in one call, by ref (e.g. PROJ-42) and/or id. Cheaper than ' +
      'repeated get_issue calls for triage. Items carry customFields but no rollup/links/' +
      'assignee_name, and omit `body` unless includeBody:true. Returned in the order refs/ids ' +
      "were given; `missing` lists (once each) any requested ref/id that didn't resolve or " +
      "isn't visible to you. " +
      OMISSION_NOTE,
    inputSchema: objectInputSchema({
      refs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Refs like PROJ-42 (max 50 combined with ids)',
      },
      ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Issue UUIDs (max 50 combined with refs)',
      },
      includeBody: {
        type: 'boolean',
        description: "Include each issue's `body` (omitted by default)",
      },
      ...BODY_CHARS_PROP,
      ...VIEW_FIELDS_PROPS,
    }),
    annotations: READ,
    async handler(input, ctx) {
      const { rest: shapeRest, ...shape } = splitShapeOpts(input)
      const { rest, bodyChars } = splitBodyChars(shapeRest)
      const result = (await getIssuesBatch(ctx, rest)) as {
        items: Record<string, unknown>[]
        missing: string[]
      }
      return {
        items: result.items.map((item) => shapeIssue(withBodyPreview(item, bodyChars), shape)),
        missing: result.missing,
      }
    },
  },
  {
    annotations: CREATE,
    description:
      'Create a new issue in a project. For an issue an agent should be able to pick up ' +
      'autonomously, the body should state acceptance criteria and scope (files/components) ' +
      "— see get_workflow's definition of ready. get_prioritized_issues excludes issues " +
      "missing these by default. Verification isn't part of the readiness bar (PROJ-738) — " +
      "it's required later, in the completionReport when entering review/done.",
    handler(input, ctx) {
      return createIssue(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['projectId', 'title'], {
      projectId: {
        type: 'string',
        description: 'UUID of the project, or a project key like PROJ',
      },
      title: { type: 'string' },
      body: { type: 'string' },
      priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
      status: {
        type: 'string',
        enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'],
      },
      statusId: { type: 'string', description: 'UUID of the task status to assign' },
      assigneeId: { type: 'string', description: 'UUID of the user to assign' },
      labels: { type: 'array', items: { type: 'string' } },
      parentId: {
        type: 'string',
        description: 'UUID of the parent issue, or a ref like PROJ-42 (optional; max depth 5)',
      },
      typeId: { type: 'string', description: 'UUID of the task type to assign' },
    }),
    name: 'create_issue',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description:
      'Update an issue — status, priority, title, body, assignee, or labels. Review gating: ' +
      'pass agentSessionId to identify yourself as an agent; entering in_review as ' +
      'an agent requires completionReport. Agents CAN transition directly to done (no human ' +
      "approval gate) — but if the completionReport.verification isn't externally checkable (no " +
      'CI run/PR/commit link), the issue is flagged needsAudit:true for after-the-fact human review.',
    handler(input, ctx) {
      const { id, ...fields } = input as { id?: string; [k: string]: unknown }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return updateIssue(ctx, id, fields)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string', description: 'UUID of the issue, or a ref like PROJ-42' },
      title: { type: 'string' },
      body: { type: 'string' },
      status: {
        type: 'string',
        enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'],
      },
      statusId: {
        type: 'string',
        nullable: true,
        description: 'UUID of the task status (null to clear)',
      },
      priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
      assigneeId: { type: 'string', nullable: true },
      labels: { type: 'array', items: { type: 'string' } },
      parentId: {
        type: 'string',
        nullable: true,
        description: 'Set or clear the parent issue — UUID or ref like PROJ-42 (null to remove)',
      },
      typeId: { type: 'string', nullable: true },
      agentSessionId: {
        type: 'string',
        description: 'Your agent session id (from register_agent) — identifies this update as agent-initiated',
      },
      completionReport: {
        type: 'object',
        description: 'Required when an agent moves an issue into in_review; also gates the done transition',
        properties: {
          summary: { type: 'string' },
          verification: { type: 'string' },
          prLink: { type: 'string' },
        },
      },
    }),
    name: 'update_issue',
  },
  {
    annotations: READ,
    description: 'Search issues by keyword in title or body',
    async handler(input, ctx) {
      return toPage((await searchIssues(ctx, input)) as unknown[])
    },
    inputSchema: requiredObjectInputSchema(['query'], {
      query: { type: 'string', minLength: 1 },
      projectId: {
        type: 'string',
        description: 'Restrict search to a specific project — UUID or project key like PROJ',
      },
      limit: { type: 'number', default: 20, description: 'Max 50' },
    }),
    name: 'search_issues',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete an issue by ID or ref (e.g. PROJ-42)',
    handler(input, ctx) {
      const { id } = input as { id?: string }
      if (!Predicate.isString(id) || String.isEmpty(id)) {
        throw new ValidationError(validationIssues(['id is required'], {}))
      }
      return deleteIssue(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string', description: 'UUID of the issue, or a ref like PROJ-42' },
    }),
    name: 'delete_issue',
  },
  {
    annotations: READ,
    description:
      'Return open issues ranked by a composite score: link-network centrality (in-degree) + priority + ' +
      'inverse story points. Useful for deciding what to work on next. By default, issues that fail the ' +
      'definition-of-ready check (missing acceptance criteria or scope/files) are excluded. ' +
      'If none of the open issues pass, the ranked (not-ready) list is returned anyway with ' +
      '`degraded: true` on the response and `needsGrooming`/`missingCriteria` on each issue, rather than ' +
      'an empty array — empty otherwise means "no open work", which would be a lie.',
    handler(input, ctx) {
      return getPrioritizedIssues(ctx, input)
    },
    inputSchema: objectInputSchema({
      limit: {
        type: 'number',
        default: 10,
        description: 'Max issues to return (default 10, max 100)',
      },
      includeBacklog: {
        type: 'boolean',
        default: true,
        description: 'Include backlog-status issues (default true)',
      },
      excludeClaimed: {
        type: 'boolean',
        default: false,
        description: 'Skip issues currently held by a live lease (default false)',
      },
      includeNotReady: {
        type: 'boolean',
        default: false,
        description:
          'Include issues that fail the definition-of-ready check, annotated with ' +
          'needsGrooming and missingCriteria (default false)',
      },
      projectId: {
        type: 'string',
        description: "Scope ranking to a single project's issues (default: workspace-wide, all visible projects)",
      },
    }),
    name: 'get_prioritized_issues',
  },
]
