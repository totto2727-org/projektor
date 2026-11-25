import { Array, Predicate } from 'effect'
import { z } from 'zod'

import { MAX_ISSUE_BODY_LENGTH, MAX_ISSUE_TITLE_LENGTH } from '../issue-limits.ts'
import { objectInOrder, BooleanQueryParam, PriorityEnum, StatusEnum, TaxonomyIdSchema } from './common.ts'
import { CustomFieldFilterSchema } from './custom-fields.ts'

const MAX_LABEL_LENGTH = 50
const MAX_LABEL_COUNT = 20
const MIN_PAGE_SIZE = 1
const DEFAULT_LIST_PAGE_SIZE = 30
const MAX_LIST_PAGE_SIZE = 100
const DEFAULT_SEARCH_PAGE_SIZE = 20
const MAX_SEARCH_PAGE_SIZE = 50
const MAX_BATCH_SIZE = 50

export const CreateIssueSchema = objectInOrder([
  ['projectId', z.string()],
  ['title', z.string().nonempty().max(MAX_ISSUE_TITLE_LENGTH)],
  ['body', z.string().max(MAX_ISSUE_BODY_LENGTH).optional()],
  ['status', StatusEnum.optional()],
  ['statusId', TaxonomyIdSchema.nullable().optional()],
  ['priority', PriorityEnum.optional()],
  ['assigneeId', z.uuid().optional()],
  ['labels', z.array(z.string().max(MAX_LABEL_LENGTH)).max(MAX_LABEL_COUNT).optional()],
  ['parentId', z.string().nullable().optional()],
  ['typeId', TaxonomyIdSchema.nullable().optional()],
  ['customFields', z.record(z.string(), z.unknown()).optional()],
]).strict()

/*
 * PROJ-254: completion report an agent (or human) submits when entering review /
 * before an issue can be marked done. Exported (PROJ-929) so finish_work's schema can
 * reuse it rather than duplicating the shape.
 */
export const CompletionReportSchema = objectInOrder([
  ['summary', z.string().nonempty()],
  ['verification', z.string().nonempty()],
  [
    'prLink',
    z
      .string()
      .transform((val) => (z.url().safeParse(val).success ? val : undefined))
      .optional(),
  ],
])

export const UpdateIssueSchema = objectInOrder([
  ['title', z.string().nonempty().max(MAX_ISSUE_TITLE_LENGTH).optional()],
  ['body', z.string().max(MAX_ISSUE_BODY_LENGTH).optional()],
  ['status', StatusEnum.optional()],
  ['statusId', TaxonomyIdSchema.nullable().optional()],
  ['priority', PriorityEnum.optional()],
  ['assigneeId', z.uuid().nullable().optional()],
  ['labels', z.array(z.string().max(MAX_LABEL_LENGTH)).max(MAX_LABEL_COUNT).optional()],
  ['parentId', z.string().nullable().optional()],
  ['typeId', TaxonomyIdSchema.nullable().optional()],
  ['customFields', z.record(z.string(), z.unknown()).optional()],
  ['agentSessionId', z.uuid().optional()],
  ['completionReport', CompletionReportSchema.optional()],
])
  .strict()
  .refine((obj) => Array.isArrayNonEmpty(Object.keys(obj)), { message: 'Nothing to update' })

export const IssueListCursorSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+(?::[A-Za-z0-9-]+)?$/)])
  .transform((cursor) => {
    if (Predicate.isNumber(cursor)) {
      return { createdAt: cursor }
    }
    const [createdAt, id] = cursor.split(':')
    return { createdAt: Number(createdAt), id }
  })

export const ListIssuesSchema = z
  .object({
    status: StatusEnum.optional(),
    statusId: TaxonomyIdSchema.optional(),
    statusIds: z.string().optional(),
    category: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
    priority: PriorityEnum.optional(),
    priorities: z.string().optional(),
    projectId: z.string().optional(),
    /*
     * PROJ-444: "me" is a sentinel the service resolves to ctx.userId — kept visible in
     * the schema (rather than folded silently into z.string()) so both surfaces document it.
     */
    assignee: z.union([z.literal('me'), z.string()]).optional(),
    parentId: z.string().optional(),
    noParent: BooleanQueryParam.optional(),
    typeId: TaxonomyIdSchema.optional(),
    excludeTypeIds: z.string().optional(),
    sprintId: z.uuid().optional(),
    ...CustomFieldFilterSchema.shape,
    // Date-range filters (PROJ-212), epoch seconds; inclusive bounds.
    completedAfter: z.coerce.number().optional(),
    completedBefore: z.coerce.number().optional(),
    updatedAfter: z.coerce.number().optional(),
    updatedBefore: z.coerce.number().optional(),
    /*
     * PROJ-375: surface agent-initiated done-closures whose evidence wasn't
     * externally checkable, for periodic human audit.
     */
    needsAudit: BooleanQueryParam.optional(),
    /*
     * PROJ-441: compute child rollups for the returned page in one grouped query
     * (see computeChildRollupsForParents in services/issues.ts) instead of the
     * frontend fanning out a getIssue call per row.
     */
    includeRollups: BooleanQueryParam.optional(),
    /*
     * PROJ-442: list items omit `body` by default (it's rarely needed and can be
     * large); set this to restore it.
     */
    includeBody: BooleanQueryParam.optional(),
    /*
     * PROJ-857: `<created_at>:<id>` — created_at alone (1 s precision) skipped rows
     * created in the same second across a page boundary. A bare number (the old
     * format) is still accepted from clients holding a pre-upgrade cursor.
     */
    cursor: IssueListCursorSchema.optional(),
    limit: z.coerce.number().min(MIN_PAGE_SIZE).max(MAX_LIST_PAGE_SIZE).default(DEFAULT_LIST_PAGE_SIZE),
  })
  .strict()

export const GetIssueSchema = z
  .object({
    id: z.string().optional(),
    ref: z.string().optional(),
  })
  .strict()
  .refine((obj) => obj.id || obj.ref, { message: 'Provide either id or ref' })

// PROJ-931: accepts either a real array (MCP JSON) or a comma-separated string
// (REST query param), same convention as the existing statusIds/excludeTypeIds filters.
const CommaOrArraySchema = z
  .union([z.string(), z.array(z.string())])
  .transform((statuses) =>
    (globalThis.Array.isArray(statuses) ? statuses : statuses.split(','))
      .map((status) => status.trim())
      .filter(Boolean),
  )

export const GetIssuesBatchSchema = objectInOrder([
  ['refs', CommaOrArraySchema.optional()],
  ['ids', CommaOrArraySchema.optional()],
  ['includeBody', BooleanQueryParam.optional()],
])
  .strict()
  .refine((obj) => (obj.refs?.length ?? 0) + (obj.ids?.length ?? 0) > 0, {
    message: 'Provide refs or ids',
  })
  .refine((obj) => (obj.refs?.length ?? 0) + (obj.ids?.length ?? 0) <= MAX_BATCH_SIZE, {
    message: 'At most 50 issues per call (refs + ids combined)',
  })

export const SearchIssuesInputSchema = objectInOrder([
  ['query', z.string().nonempty()],
  ['projectId', z.string().optional()],
  ['limit', z.number().int().min(MIN_PAGE_SIZE).max(MAX_SEARCH_PAGE_SIZE).optional().default(DEFAULT_SEARCH_PAGE_SIZE)],
]).strict()

export const LinkTypeInputEnum = z.enum(['blocks', 'blocked_by', 'relates_to', 'duplicates'])
export const LinkTypeStoredEnum = z.enum(['blocks', 'relates_to', 'duplicates'])

export const CreateIssueLinkSchema = z
  .object({
    sourceIssueId: z.string(),
    targetIssueId: z.string(),
    type: LinkTypeInputEnum,
  })
  .strict()

export const DeleteIssueLinkSchema = z
  .object({
    id: z.uuid(),
  })
  .strict()

export const ListIssueLinksSchema = z
  .object({
    issueId: z.string(),
  })
  .strict()
