import { Predicate, Schema } from 'effect'

import { structInOrder } from '#contracts/ordered-schema.ts'
import {
  MAX_PAGE_CONTENT_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_WIKI_TYPE_LENGTH,
} from '#contracts/wiki-limits.ts'
import { UploadFileSchema } from '@/attachments.ts'

const MIN_PAGE_TITLE_LENGTH = 1
const MAX_TAG_FILTER_TEXT_LENGTH = 2549
const MAX_SEARCH_QUERY_LENGTH = 2000
const title = Schema.String.check(Schema.isMinLength(MIN_PAGE_TITLE_LENGTH), Schema.isMaxLength(MAX_PAGE_TITLE_LENGTH))
const content = Schema.String.check(Schema.isMaxLength(MAX_PAGE_CONTENT_LENGTH))
const slug = Schema.String.check(
  Schema.isMaxLength(MAX_SLUG_LENGTH),
  Schema.isPattern(/^[a-z0-9-]*$/u, { toJsonSchema: () => [{}, true] }),
)

export const EditFields = structInOrder([
  ['title', title],
  ['content', content],
  ['baseRevisionId', Schema.optional(Schema.NullOr(Schema.String))],
])
export const CreateFields = structInOrder([
  ['title', title],
  ['slug', slug],
  ['content', content],
  ['parentId', Schema.NullOr(Schema.String)],
  ['templateSlug', Schema.String.check(Schema.isMaxLength(MAX_SLUG_LENGTH))],
])
export const FilterFields = structInOrder([
  ['type', Schema.String.check(Schema.isMaxLength(MAX_WIKI_TYPE_LENGTH))],
  ['status', Schema.Literals(['', 'draft', 'current', 'stale', 'deprecated'])],
  ['tags', Schema.String.check(Schema.isMaxLength(MAX_TAG_FILTER_TEXT_LENGTH))],
])
export const SearchFields = Schema.Struct({ query: Schema.String.check(Schema.isMaxLength(MAX_SEARCH_QUERY_LENGTH)) })
export const MoveFields = Schema.Struct({ parentId: Schema.String })
export const AttachmentFields = Schema.Struct({
  file: Schema.NullOr(UploadFileSchema).check(
    Schema.makeFilter((file) => Predicate.isNotNullish(file) || 'Choose a file.'),
  ),
})
