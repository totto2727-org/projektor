import { Schema } from 'effect'

import { JSON_NULL } from '#contracts/json-null.ts'
import { ReviewStatusSchema, ReviewTargetSchema } from '#contracts/review-targets.ts'
import type { Issue as ListIssue, TaskStatus } from '@/features/issues/components/board-utils.ts'
import type {
  Attachment,
  Comment,
  IssueData,
  IssueLink,
  Member,
  TaskType,
} from '@/features/issues/components/issue-detail-helpers.ts'
export type Issue = IssueData & ListIssue
export type {
  Attachment,
  Comment,
  IssueLink,
  Member,
  TaskType,
} from '@/features/issues/components/issue-detail-helpers.ts'
export type { TaskStatus as Status } from '@/features/issues/components/board-utils.ts'
export interface IssuePage {
  items: Issue[]
  nextCursor?: string | number | null
  total?: number | null
}
const nullable = Schema.NullOr(Schema.String)
const field = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  type: Schema.String,
  value: Schema.String,
})
export const IssueSchema = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.optional(nullable),
  priority: Schema.String,
  project_id: nullable,
  project_key: nullable,
  project_name: nullable,
  status_id: nullable,
  status_key: nullable,
  status_name: nullable,
  status_category: nullable,
  type_id: Schema.optional(nullable),
  type_key: nullable,
  type_name: nullable,
  parent_id: nullable,
  assignee_id: nullable,
  // The listIssues query joins users, while getIssue intentionally omits this list-only alias.
  assignee_name: Schema.optional(nullable),
  sprint_id: Schema.optional(nullable),
  created_at: Schema.Number,
  updated_at: Schema.Number,
  reviewTargets: Schema.Array(ReviewTargetSchema),
  customFields: Schema.optional(Schema.Array(field)),
  rollup: Schema.optional(
    Schema.Struct({
      done: Schema.Number,
      remaining: Schema.Number,
      total: Schema.Number,
      byStatus: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
    }),
  ),
})
/**
 * Normalize a decoded issue after the native loader validates its concrete schema.
 *
 * @param {typeof IssueSchema.Type} dto The validated issue response.
 * @returns {Issue} An issue with explicit nullable fields and copied nested records for page consumers.
 */
export const normalizeIssue = function normalizeIssue(dto: typeof IssueSchema.Type): Issue {
  return {
    ...dto,
    body: dto.body ?? JSON_NULL,
    assignee_name: dto.assignee_name ?? JSON_NULL,
    type_id: dto.type_id ?? JSON_NULL,
    sprint_id: dto.sprint_id ?? JSON_NULL,
    customFields: dto.customFields?.map((entry) => ({ ...entry })) ?? [],
    reviewTargets: dto.reviewTargets.map((entry) => ({ ...entry })),
    rollup: dto.rollup ? { ...dto.rollup, byStatus: { ...dto.rollup.byStatus } } : undefined,
  }
}
export const IssuePageSchema = Schema.Struct({
  items: Schema.Array(IssueSchema),
  nextCursor: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  total: Schema.optional(Schema.NullOr(Schema.Number)),
})
export const normalizeIssuePage = function normalizeIssuePage(dto: typeof IssuePageSchema.Type): IssuePage {
  return { ...dto, items: dto.items.map(normalizeIssue) }
}
export const StatusSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
  category: Schema.String,
  color: Schema.optional(nullable),
})
export const StatusesSchema = Schema.Array(StatusSchema)
export const normalizeStatuses = function normalizeStatuses(dto: typeof StatusesSchema.Type): TaskStatus[] {
  return dto.map((entry) => ({ ...entry, color: entry.color ?? JSON_NULL }))
}
export const TaskTypeSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
})
export const TaskTypesSchema = Schema.Array(TaskTypeSchema)
export const normalizeTaskTypes = function normalizeTaskTypes(dto: typeof TaskTypesSchema.Type): TaskType[] {
  return dto.map((entry) => ({ ...entry }))
}
export const CommentSchema = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  author_id: Schema.optional(nullable),
  author_name: Schema.optional(nullable),
  author_email: Schema.optional(Schema.String),
  created_at: Schema.Number,
})
export const CommentsSchema = Schema.Array(CommentSchema)
export const normalizeComments = function normalizeComments(dto: typeof CommentsSchema.Type): Comment[] {
  return dto.map((entry) => ({
    ...entry,
    author_id: entry.author_id ?? '',
    author_name: entry.author_name ?? 'Unknown user',
    author_email: entry.author_email ?? '',
  }))
}
export const IssueLinkSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.Literals(['blocks', 'blocked_by', 'relates_to', 'duplicates']),
  linkedIssueId: Schema.String,
  linkedIssueTitle: Schema.String,
  linkedIssueNumber: Schema.Number,
  linkedIssueProjectKey: Schema.String,
  linkedIssueStatusCategory: Schema.String,
  createdById: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.Number),
})
export const LinksSchema = Schema.Array(IssueLinkSchema)
export const normalizeLinks = function normalizeLinks(dto: typeof LinksSchema.Type): IssueLink[] {
  return dto.map((entry) => ({
    ...entry,
    createdById: entry.createdById ?? '',
    createdAt: entry.createdAt ?? 0,
  }))
}
export const AttachmentSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.optional(Schema.Literals(['file', 'wiki_ref', 'url'])),
  filename: Schema.String,
  contentType: Schema.String,
  size: Schema.Number,
  createdAt: Schema.Number,
  reviewStatus: Schema.NullOr(ReviewStatusSchema),
  url: Schema.optional(nullable),
  wikiPage: Schema.optional(
    Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String, url: Schema.String })),
  ),
})
export const AttachmentsSchema = Schema.Array(AttachmentSchema)
export const normalizeAttachments = function normalizeAttachments(dto: typeof AttachmentsSchema.Type): Attachment[] {
  return dto.map((entry) => ({
    ...entry,
    kind: entry.kind ?? 'file',
    url: entry.url ?? JSON_NULL,
    wikiPage: entry.wikiPage ? { ...entry.wikiPage } : JSON_NULL,
  }))
}
export const MemberSchema = Schema.Struct({
  id: Schema.String,
  name: nullable,
  email: Schema.String,
})
export const MembersSchema = Schema.Struct({ members: Schema.Array(MemberSchema) })
export const normalizeMembers = function normalizeMembers(dto: typeof MembersSchema.Type): { members: Member[] } {
  return { members: dto.members.map((entry) => ({ ...entry })) }
}
