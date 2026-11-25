import { Schema } from 'effect'

import { MAX_ISSUE_BODY_LENGTH, MAX_ISSUE_TITLE_LENGTH } from '#contracts/issue-limits.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { extendStructInOrder, structInOrder } from '#contracts/ordered-schema.ts'
import { ReviewTargetSchema } from '#contracts/review-targets.ts'

const NonEmpty = Schema.String.check(Schema.isMinLength(1))
export const SelectorFields = {
  workspaceSlug: Schema.optional(NonEmpty),
  projectId: Schema.optional(NonEmpty),
}
export const IssueIdentitySchema = Schema.Struct({ ...SelectorFields, issueId: NonEmpty })
export const IssuePatchSchema = structInOrder([
  ['title', Schema.optional(NonEmpty)],
  ['body', Schema.optional(Schema.String)],
  ['statusId', Schema.optional(NonEmpty)],
  ['priority', Schema.optional(Schema.String)],
  ['typeId', Schema.optional(Schema.NullOr(NonEmpty))],
  ['assigneeId', Schema.optional(Schema.NullOr(NonEmpty))],
  ['parentId', Schema.optional(Schema.NullOr(NonEmpty))],
  ['customFields', Schema.optional(Schema.Struct({ story_points: Schema.NullOr(Schema.String) }))],
])
const CreateIssueFields = fieldsInOrder([
  ['projectId', NonEmpty],
  // Preserve the existing schema output while checking the title at runtime.
  [
    'title',
    Schema.String.check(
      Schema.isPattern(/\S/u, { toJsonSchema: () => [{}, true] }),
      Schema.isMaxLength(MAX_ISSUE_TITLE_LENGTH),
    ),
  ],
  ['body', Schema.optional(Schema.String.check(Schema.isMaxLength(MAX_ISSUE_BODY_LENGTH)))],
  ['priority', Schema.optional(Schema.Literals(['urgent', 'high', 'medium', 'low', 'none']))],
  ['statusId', Schema.optional(NonEmpty)],
  ['typeId', Schema.optional(NonEmpty)],
])
export const CreateIssueSchema = Schema.Struct({ ...SelectorFields, ...CreateIssueFields })
export const IssuePageInputSchema = extendStructInOrder(SelectorFields, [
  ['statusIds', Schema.optional(Schema.String)],
  ['priorities', Schema.optional(Schema.String)],
  ['typeId', Schema.optional(Schema.String)],
  ['parentId', Schema.optional(Schema.String)],
  ['noParent', Schema.optional(Schema.String)],
  ['excludeTypeIds', Schema.optional(Schema.String)],
  ['sprintId', Schema.optional(Schema.String)],
  ['completedAfter', Schema.optional(Schema.String)],
  ['completedBefore', Schema.optional(Schema.String)],
  ['updatedAfter', Schema.optional(Schema.String)],
  ['updatedBefore', Schema.optional(Schema.String)],
  ['cursor', Schema.optional(Schema.String)],
  ['limit', Schema.optional(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 100 })))],
  ['includeRollups', Schema.optional(Schema.Boolean)],
])
export const SearchResultsSchema = Schema.Array(
  structInOrder([
    ['id', Schema.String],
    ['number', Schema.Number],
    ['title', Schema.String],
    ['status', Schema.String],
    ['priority', Schema.String],
    ['project_id', Schema.NullOr(Schema.String)],
    ['project_key', Schema.NullOr(Schema.String)],
    ['project_name', Schema.NullOr(Schema.String)],
    ['reviewTargets', Schema.Array(ReviewTargetSchema)],
  ]),
)
export const WikiSearchResultsSchema = Schema.Array(
  structInOrder([
    ['id', Schema.String],
    ['title', Schema.String],
    ['slug', Schema.String],
    ['project_id', Schema.NullOr(Schema.String)],
  ]),
)
export const OkSchema = Schema.Struct({ ok: Schema.Boolean })
export const CreatedSchema = Schema.Struct({ id: Schema.String })
