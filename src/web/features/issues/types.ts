import { Schema } from 'effect'

import type { Issue as ListIssue, TaskStatus } from './legacy/board-utils'
import type { Attachment, Comment, IssueData, IssueLink, Member, TaskType } from './legacy/issue-detail-helpers'
export type Issue = IssueData & ListIssue
export type { Attachment, Comment, IssueLink, Member, TaskType }
export type Status = TaskStatus
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
  // listIssues joins users, while getIssue intentionally omits this list-only alias.
  assignee_name: Schema.optional(nullable),
  sprint_id: Schema.optional(nullable),
  created_at: Schema.Number,
  updated_at: Schema.Number,
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
/** DTO normalization is pure. RequestApi validates these schemas in its Effect channel. */
export function normalizeIssue(dto: typeof IssueSchema.Type): Issue {
  return {
    ...dto,
    body: dto.body ?? null,
    assignee_name: dto.assignee_name ?? null,
    type_id: dto.type_id ?? null,
    sprint_id: dto.sprint_id ?? null,
    customFields: dto.customFields?.map((entry) => ({ ...entry })) ?? [],
    rollup: dto.rollup ? { ...dto.rollup, byStatus: { ...dto.rollup.byStatus } } : undefined,
  }
}
export const IssuePageSchema = Schema.Struct({
  items: Schema.Array(IssueSchema),
  nextCursor: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  total: Schema.optional(Schema.NullOr(Schema.Number)),
})
export function normalizeIssuePage(dto: typeof IssuePageSchema.Type): IssuePage {
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
export function normalizeStatuses(dto: typeof StatusesSchema.Type): Status[] {
  return dto.map((entry) => ({ ...entry, color: entry.color ?? null }))
}
export const TaskTypeSchema = Schema.Struct({
  id: Schema.String,
  key: Schema.String,
  name: Schema.String,
})
export const TaskTypesSchema = Schema.Array(TaskTypeSchema)
export function normalizeTaskTypes(dto: typeof TaskTypesSchema.Type): TaskType[] {
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
export function normalizeComments(dto: typeof CommentsSchema.Type): Comment[] {
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
export function normalizeLinks(dto: typeof LinksSchema.Type): IssueLink[] {
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
  url: Schema.optional(nullable),
  wikiPage: Schema.optional(
    Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String, url: Schema.String })),
  ),
})
export const AttachmentsSchema = Schema.Array(AttachmentSchema)
export function normalizeAttachments(dto: typeof AttachmentsSchema.Type): Attachment[] {
  return dto.map((entry) => ({
    ...entry,
    kind: entry.kind ?? 'file',
    url: entry.url ?? null,
    wikiPage: entry.wikiPage ? { ...entry.wikiPage } : null,
  }))
}
export const MemberSchema = Schema.Struct({
  id: Schema.String,
  name: nullable,
  email: Schema.String,
})
export const MembersSchema = Schema.Struct({ members: Schema.Array(MemberSchema) })
export function normalizeMembers(dto: typeof MembersSchema.Type): { members: Member[] } {
  return { members: dto.members.map((entry) => ({ ...entry })) }
}
