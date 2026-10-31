import { Schema } from 'effect'

import type { WikiSeed } from './WikiPageClient'

const strings = Schema.mutable(Schema.Array(Schema.String))
const nullable = Schema.NullOr(Schema.String)
export const Freshness = Schema.NullOr(
  Schema.Struct({
    state: Schema.Literals(['fresh', 'stale', 'unverified']),
    staleSince: Schema.NullOr(Schema.Number),
  }),
)
export const ListItem = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  type: nullable,
  status: nullable,
  tags: strings,
})
export const Page = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  content: Schema.String,
  revisionId: Schema.optional(nullable),
  project_id: nullable,
  parent_id: nullable,
  updated_at: Schema.Number,
  type: nullable,
  tags: strings,
  status: nullable,
  verified_at: Schema.NullOr(Schema.Number),
  verified_by: nullable,
  owners: strings,
  verify_interval: Schema.NullOr(Schema.Number),
  freshness: Freshness,
})
export const Revision = Schema.Struct({
  id: Schema.String,
  author_id: nullable,
  author_name: nullable,
  created_at: Schema.Number,
  summary: nullable,
})
export const Attachment = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  contentType: Schema.String,
  size: Schema.Number,
  createdAt: Schema.Number,
})
export const Template = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
})
export const StalePage = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  freshness: Freshness,
})
export const SearchResult = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  project_id: nullable,
  excerpt: nullable,
  type: nullable,
  tags: strings,
  status: nullable,
  freshness: Freshness,
})
export const Draft = Schema.NullOr(
  Schema.Struct({
    title: Schema.String,
    content: Schema.String,
    baseRevisionId: nullable,
    updatedAt: Schema.Number,
  }),
)
export const TreeNode: Schema.Decoder<WikiSeed['tree'][number]> = Schema.suspend(() =>
  Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    title: Schema.String,
    type: nullable,
    children: Schema.mutable(Schema.Array(TreeNode)),
  }),
)
export const Tree = Schema.mutable(Schema.Array(TreeNode))
export const Ok = Schema.Struct({ ok: Schema.Literal(true) })
export const Created = Schema.Struct({ id: Schema.String, slug: Schema.String })
export const Deleted = Schema.Struct({
  ok: Schema.Literal(true),
  deletedCount: Schema.Number,
  linkedByCount: Schema.Number,
})
export const Restored = Schema.Struct({
  ok: Schema.Literal(true),
  id: Schema.String,
  slug: Schema.String,
  restoredCount: Schema.Number,
})
export const SavedDraft = Schema.Struct({
  ok: Schema.Literal(true),
  pageId: Schema.String,
  updatedAt: Schema.Number,
})
export const Verified = Schema.Struct({
  ok: Schema.Literal(true),
  verifiedAt: Schema.NullOr(Schema.Number),
  verifiedBy: nullable,
  freshness: Freshness,
})
