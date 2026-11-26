import { Schema } from 'effect'

import { BooleanSchema, NN, NS, NumberSchema, Ok, StringSchema, array } from './api-result-codecs.ts'
import { fieldsInOrder } from './ordered-fields.ts'
import { extendStructInOrder, structInOrder } from './ordered-schema.ts'

const Freshness = Schema.NullOr(
  structInOrder([
    ['state', Schema.Literals(['fresh', 'stale', 'unverified'])],
    ['staleSince', NN],
  ]),
)

const WikiMetadataFields = fieldsInOrder([
  ['type', NS],
  ['tags', array(StringSchema)],
  ['status', NS],
  ['verified_at', NN],
  ['verified_by', NS],
  ['owners', array(StringSchema)],
  ['verify_interval', NN],
  ['is_template', BooleanSchema],
])

const WikiIdentityFields = fieldsInOrder([
  ['id', StringSchema],
  ['slug', StringSchema],
  ['title', StringSchema],
  ['project_id', NS],
])

const WikiSummaryFields = { ...WikiIdentityFields, parent_id: NS, updated_at: NumberSchema, ...WikiMetadataFields }

const WikiSummary = Schema.Struct({ ...WikiSummaryFields, url: StringSchema })

const WikiPage = extendStructInOrder(WikiSummaryFields, [
  ['content', StringSchema],
  ['version', Schema.optional(NumberSchema)],
  ['revisionId', NS],
  ['url', StringSchema],
  ['freshness', Freshness],
])

const WikiRevisionFields = fieldsInOrder([
  ['id', StringSchema],
  ['title', StringSchema],
  ['summary', NS],
  ['author_id', StringSchema],
  ['created_at', NumberSchema],
])

type WikiTreeNode = Readonly<{
  id: string
  slug: string
  title: string
  url: string
  type: string | null
  children: WikiTreeNode[]
}>

const WikiTreeNodeCodec: Schema.Codec<WikiTreeNode> = Schema.suspend(() =>
  structInOrder([
    ['id', StringSchema],
    ['slug', StringSchema],
    ['title', StringSchema],
    ['url', StringSchema],
    ['type', NS],
    ['children', array(WikiTreeNodeCodec)],
  ]),
)

const WikiDraft = Schema.NullOr(
  structInOrder([
    ['title', StringSchema],
    ['content', StringSchema],
    ['baseRevisionId', NS],
    ['updatedAt', NumberSchema],
  ]),
)

const WikiChange = structInOrder([
  ['id', StringSchema],
  ['action', Schema.Literals(['created', 'updated', 'deleted'])],
  ['pageId', StringSchema],
  ['slug', NS],
  ['title', NS],
  ['projectId', NS],
  ['actorId', NS],
  ['createdAt', NumberSchema],
  ['deletedPageIds', Schema.NullOr(array(StringSchema))],
  ['deletedPageIdsTruncated', BooleanSchema],
])

export const wikiResults = [
  ['apiListWikiPages', array(WikiSummary)],
  [
    'apiSearchWiki',
    array(
      extendStructInOrder(WikiIdentityFields, [
        ['type', NS],
        ['tags', array(StringSchema)],
        ['status', NS],
        ['verified_at', NN],
        ['verified_by', NS],
        ['owners', array(StringSchema)],
        ['verify_interval', NN],
        ['excerpt', StringSchema],
        ['rank', NumberSchema],
        ['freshness', Freshness],
      ]),
    ),
  ],
  ['apiGetWikiPage', WikiPage],
  [
    'apiGetWikiBacklinks',
    array(
      structInOrder([
        ['linkId', StringSchema],
        ['pageId', StringSchema],
        ['slug', StringSchema],
        ['title', StringSchema],
        ['url', StringSchema],
        ['snippet', NS],
      ]),
    ),
  ],
  [
    'apiCreateWikiPage',
    structInOrder([
      ['id', StringSchema],
      ['slug', StringSchema],
      ['projectId', NS],
      ['url', StringSchema],
      ['type', NS],
      ['tags', array(StringSchema)],
      ['status', NS],
      ['verifiedAt', NN],
      ['verifiedBy', NS],
      ['owners', array(StringSchema)],
      ['verifyInterval', NN],
      ['isTemplate', BooleanSchema],
    ]),
  ],
  ['apiUpdateWikiPage', Schema.Struct({ ok: BooleanSchema, url: StringSchema })],
  [
    'apiVerifyWikiPage',
    structInOrder([
      ['ok', BooleanSchema],
      ['verifiedAt', NN],
      ['verifiedBy', NS],
      ['url', StringSchema],
      ['freshness', Freshness],
    ]),
  ],
  [
    'apiListStaleWikiPages',
    array(
      extendStructInOrder(WikiIdentityFields, [
        ['status', NS],
        ['verified_at', NN],
        ['verified_by', NS],
        ['verify_interval', NN],
        ['updated_at', NumberSchema],
        ['url', StringSchema],
        ['freshness', Freshness],
      ]),
    ),
  ],
  ['apiPatchWikiPage', Schema.Struct({ ok: BooleanSchema, url: StringSchema })],
  ['apiListWikiTemplates', array(Schema.Struct({ ...WikiIdentityFields, type: NS, url: StringSchema }))],
  [
    'apiDeleteWikiPage',
    structInOrder([
      ['ok', BooleanSchema],
      ['deletedCount', NumberSchema],
      ['linkedByCount', NumberSchema],
    ]),
  ],
  [
    'apiUndeleteWikiPage',
    structInOrder([
      ['ok', BooleanSchema],
      ['id', StringSchema],
      ['slug', StringSchema],
      ['url', StringSchema],
      ['restoredCount', NumberSchema],
    ]),
  ],
  [
    'apiListWikiTrash',
    array(
      extendStructInOrder(WikiIdentityFields, [
        ['parent_id', NS],
        ['deleted_at', NN],
        ['purgeAfter', NumberSchema],
      ]),
    ),
  ],
  ['apiGetWikiTree', array(WikiTreeNodeCodec)],
  ['apiListWikiRevisions', array(Schema.Struct({ ...WikiRevisionFields, author_name: NS }))],
  ['apiGetWikiRevision', Schema.Struct({ ...WikiRevisionFields, content: StringSchema })],
  [
    'apiGetWikiRevisionDiff',
    structInOrder([
      ['from', StringSchema],
      ['to', StringSchema],
      ['diff', StringSchema],
    ]),
  ],
  ['apiGetWikiDraft', WikiDraft],
  ['apiSaveWikiDraft', Schema.Struct({ ok: BooleanSchema, pageId: StringSchema, updatedAt: NumberSchema })],
  ['apiDiscardWikiDraft', Ok],
  [
    'apiWatchWikiPage',
    Schema.Struct({
      ok: BooleanSchema,
      pageId: StringSchema,
      subtree: BooleanSchema,
      url: StringSchema,
    }),
  ],
  ['apiUnwatchWikiPage', Ok],
  [
    'apiListWikiWatches',
    array(
      structInOrder([
        ['id', StringSchema],
        ['pageId', StringSchema],
        ['subtree', BooleanSchema],
        ['createdAt', NumberSchema],
        ['slug', StringSchema],
        ['title', StringSchema],
        ['url', StringSchema],
      ]),
    ),
  ],
  [
    'apiListWikiNotifications',
    array(
      structInOrder([
        ['id', StringSchema],
        ['pageId', NS],
        ['slug', StringSchema],
        ['title', StringSchema],
        ['action', StringSchema],
        ['actorId', NS],
        ['summary', NS],
        ['createdAt', NumberSchema],
        ['readAt', NN],
        ['url', StringSchema],
      ]),
    ),
  ],
  ['apiMarkWikiNotificationsRead', Ok],
  ['apiListWikiChanges', Schema.Struct({ changes: array(WikiChange), nextSince: NumberSchema })],
] as const
