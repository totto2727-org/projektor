import { Schema } from 'effect'

import { ApiPrincipal, ApiUserBootstrap, ApiWorkspace } from './api-auth.ts'
import { ReviewStatusSchema } from './review-targets.ts'

type SchemaField = Readonly<[name: string, codec: Schema.Top]>
type SchemaFields = Readonly<SchemaField[]>
type FieldName<Field extends SchemaField> =
  Field extends Readonly<[infer Name extends string, Schema.Top]> ? Name : never
type FieldCodec<Field extends SchemaField> =
  Field extends Readonly<[string, infer Codec extends Schema.Top]> ? Codec : never
type FieldsInOrder<Entries extends SchemaFields> = {
  [Entry in Entries[number] as FieldName<Entry>]: FieldCodec<Entry>
}

const fieldsInOrder = function fieldsInOrder<const Entries extends SchemaFields>(
  entries: Entries,
): FieldsInOrder<Entries> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The entry tuples specify each schema and preserve response field order.
  return Object.fromEntries(entries) as FieldsInOrder<Entries>
}

const structInOrder = function structInOrder<const Entries extends SchemaFields>(
  entries: Entries,
): Schema.Struct<FieldsInOrder<Entries>> {
  return Schema.Struct(fieldsInOrder(entries))
}

const extendStructInOrder = function extendStructInOrder<
  Base extends Schema.Struct.Fields,
  const Entries extends SchemaFields,
>(
  base: Base,
  entries: Entries & (Extract<keyof Base, FieldName<Entries[number]>> extends never ? unknown : never),
): Schema.Struct<Base & FieldsInOrder<Entries>> {
  return Schema.Struct({ ...base, ...fieldsInOrder<Entries>(entries) })
}

const array = <Item extends Schema.Top>(item: Item): Schema.mutable<Schema.$Array<Item>> =>
  Schema.mutable(Schema.Array(item))

const StringSchema = Schema.String
const NumberSchema = Schema.Number
const BooleanSchema = Schema.Boolean
const NS = Schema.NullOr(StringSchema)
const NN = Schema.NullOr(NumberSchema)
const Id = Schema.Struct({ id: StringSchema })
const Ok = Schema.Struct({ ok: BooleanSchema })
const Named = Schema.Struct({ id: StringSchema, name: StringSchema })
const Keyed = Schema.Struct({ id: StringSchema, key: StringSchema, name: StringSchema })
const CreatedIssue = Schema.Struct({ id: StringSchema, number: Schema.optional(NumberSchema) })

const SessionFields = fieldsInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['issueId', NS],
  ['tokenId', NS],
  ['name', StringSchema],
  ['status', Schema.Literals(['active', 'ended'])],
  ['startedAt', NumberSchema],
  ['lastHeartbeatAt', NumberSchema],
  ['endedAt', NN],
])
const Session = Schema.Struct(SessionFields)
const Lease = structInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['issueId', StringSchema],
  ['agentSessionId', StringSchema],
  ['claimedAt', NumberSchema],
  ['releasedAt', NN],
  ['releaseReason', NS],
])
const ClaimFields = fieldsInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['issueId', StringSchema],
  ['agentId', NS],
  ['path', StringSchema],
  ['claimedAt', NumberSchema],
  ['releasedAt', NN],
])
const Claim = Schema.Struct(ClaimFields)
const Message = structInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['scope', StringSchema],
  ['agentId', NS],
  ['body', StringSchema],
  ['createdAt', NumberSchema],
])
const ReleasedClaim = Schema.Struct({ ...ClaimFields, releaseReason: NS })
const ActiveClaim = extendStructInOrder(ClaimFields, [
  ['releaseReason', NS],
  ['live', BooleanSchema],
])
const Claims = Schema.Struct({
  created: array(Claim),
  overridden: array(ActiveClaim),
  reclaimed: array(ActiveClaim),
})
const Comment = structInOrder([
  ['id', StringSchema],
  ['body', StringSchema],
  ['created_at', NumberSchema],
  ['updated_at', NumberSchema],
  ['author_id', StringSchema],
  ['author_name', StringSchema],
  ['author_email', StringSchema],
])
const Attachment = structInOrder([
  ['id', StringSchema],
  ['kind', Schema.Literals(['file', 'wiki_ref', 'url'])],
  ['filename', StringSchema],
  ['contentType', StringSchema],
  ['size', NumberSchema],
  ['url', NS],
  ['createdAt', NumberSchema],
  ['reviewStatus', Schema.NullOr(ReviewStatusSchema)],
  ['wikiPage', Schema.NullOr(Schema.Struct({ id: StringSchema, title: NS, url: StringSchema }))],
])
const CustomField = structInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['projectId', NS],
  ['key', StringSchema],
  ['label', StringSchema],
  ['type', Schema.Literals(['text', 'number', 'select', 'date', 'user'])],
  ['options', Schema.NullOr(array(StringSchema))],
  ['createdAt', NumberSchema],
  ['isInternal', BooleanSchema],
])
const GroupFields = fieldsInOrder([
  ['id', StringSchema],
  ['name', StringSchema],
  ['description', NS],
  ['createdAt', NumberSchema],
])
const Group = extendStructInOrder(GroupFields, [
  ['memberCount', NumberSchema],
  ['grantCount', NumberSchema],
])
const GroupGrantRole = Schema.Literals(['viewer', 'member', 'admin'])
const GroupDetail = extendStructInOrder(GroupFields, [
  ['workspaceId', StringSchema],
  [
    'members',
    array(
      structInOrder([
        ['userId', StringSchema],
        ['email', StringSchema],
        ['name', StringSchema],
        ['addedAt', NumberSchema],
        ['addedBy', StringSchema],
      ]),
    ),
  ],
  [
    'grants',
    array(
      structInOrder([
        ['projectId', StringSchema],
        ['projectName', StringSchema],
        ['projectKey', StringSchema],
        ['role', GroupGrantRole],
      ]),
    ),
  ],
])
const Sprint = structInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['projectId', StringSchema],
  ['name', StringSchema],
  ['goal', NS],
  ['status', Schema.Literals(['planned', 'active', 'completed'])],
  ['startDate', NN],
  ['endDate', NN],
  ['createdAt', NumberSchema],
  ['updatedAt', NumberSchema],
])
const Feedback = structInOrder([
  ['id', StringSchema],
  ['sourceId', StringSchema],
  ['sourceName', NS],
  ['rating', NN],
  ['ratingScale', NS],
  ['body', NS],
  ['submitterLabel', NS],
  ['sourceUrl', NS],
  ['appVersion', NS],
  ['status', StringSchema],
  ['linkedIssueId', NS],
  ['createdAt', NumberSchema],
])
const FeedbackSourceFields = fieldsInOrder([
  ['id', StringSchema],
  ['name', StringSchema],
  ['description', NS],
  ['isActive', BooleanSchema],
  ['allowedOrigins', Schema.NullOr(array(StringSchema))],
  ['tokenPreview', StringSchema],
  ['createdAt', NumberSchema],
  ['revokedAt', NN],
])
const FeedbackSource = Schema.Struct(FeedbackSourceFields)
const FeedbackVersionSummary = structInOrder([
  ['appVersion', NS],
  ['totalCount', NumberSchema],
  ['withCommentCount', NumberSchema],
  ['thumbsUpPct', NN],
  ['avgFiveStar', NN],
  ['lastSeenAt', NumberSchema],
])
const FeedbackSummary = array(
  Schema.Struct({
    sourceId: StringSchema,
    sourceName: NS,
    totalCount: NumberSchema,
    versions: array(FeedbackVersionSummary),
  }),
)
const Activity = structInOrder([
  ['type', StringSchema],
  ['actor', NS],
  ['entity_type', StringSchema],
  ['entity_id', StringSchema],
  ['entity_ref', StringSchema],
  ['summary', StringSchema],
  ['created_at', NumberSchema],
])
const Brand = structInOrder([
  ['displayName', NS],
  ['accent', NS],
  ['onAccent', NS],
  ['fontFamily', NS],
  ['fontUrl', NS],
  ['logoUrl', NS],
])
const Distribution = structInOrder([
  ['count', NumberSchema],
  ['avg', NN],
  ['p50', NN],
  ['p90', NN],
])
const HeatmapEntryFields = fieldsInOrder([
  ['path', StringSchema],
  ['segment', StringSchema],
  ['isLeaf', BooleanSchema],
])
const ClaimHeatmapEntry = extendStructInOrder(HeatmapEntryFields, [
  ['distinctIssueCount', NumberSchema],
  ['claimCount', NumberSchema],
])
const ContentionHeatmapEntry = extendStructInOrder(HeatmapEntryFields, [
  ['distinctRejectedIssueCount', NumberSchema],
  ['conflictCount', NumberSchema],
])
const Heatmap = Schema.Union([
  structInOrder([
    ['prefix', StringSchema],
    ['mode', Schema.Literal('claims')],
    ['totalDistinctIssues', NumberSchema],
    ['entries', array(ClaimHeatmapEntry)],
  ]),
  structInOrder([
    ['prefix', StringSchema],
    ['mode', Schema.Literal('contention')],
    ['totalDistinctIssues', NumberSchema],
    ['entries', array(ContentionHeatmapEntry)],
  ]),
])
const Project = structInOrder([
  ['id', StringSchema],
  ['workspaceId', StringSchema],
  ['name', StringSchema],
  ['key', StringSchema],
  ['description', NS],
  ['createdAt', NumberSchema],
  ['updatedAt', NumberSchema],
  ['agentWipLimit', NN],
  ['slug', NS],
  ['archivedAt', NN],
])
const ProjectSummary = structInOrder([
  ['id', StringSchema],
  ['name', StringSchema],
  ['key', StringSchema],
  ['slug', NS],
  ['description', NS],
  ['workspace_id', StringSchema],
  ['workspace_name', StringSchema],
  ['workspace_slug', StringSchema],
  ['open_issue_count', NumberSchema],
  ['backlog_issue_count', NumberSchema],
  ['archived_at', NN],
  ['created_at', NumberSchema],
  ['updated_at', NumberSchema],
])
const TaskType = structInOrder([
  ['id', StringSchema],
  ['workspace_id', StringSchema],
  ['key', StringSchema],
  ['name', StringSchema],
  ['color', NS],
  ['icon', NS],
  ['position', NumberSchema],
  ['is_default', NumberSchema],
])
const TaskStatus = structInOrder([
  ['id', StringSchema],
  ['workspace_id', StringSchema],
  ['key', StringSchema],
  ['name', StringSchema],
  ['color', NS],
  ['position', NumberSchema],
  ['is_default', NumberSchema],
  ['is_review_step', NumberSchema],
  ['category', Schema.Literals(['todo', 'in_progress', 'done', 'cancelled'])],
])
const IssueLink = structInOrder([
  ['id', StringSchema],
  ['type', Schema.Literals(['blocks', 'blocked_by', 'relates_to', 'duplicates'])],
  ['linkedIssueId', StringSchema],
  ['linkedIssueTitle', StringSchema],
  ['linkedIssueNumber', NumberSchema],
  ['linkedIssueProjectKey', StringSchema],
  ['linkedIssueStatusCategory', StringSchema],
  ['createdById', StringSchema],
  ['createdAt', NumberSchema],
])
const Rollup = structInOrder([
  ['total', NumberSchema],
  ['byStatus', Schema.Record(StringSchema, NumberSchema)],
  ['done', NumberSchema],
  ['remaining', NumberSchema],
])
const FieldValue = Schema.Struct({ key: StringSchema, label: StringSchema, type: StringSchema, value: StringSchema })
const IssueFields = fieldsInOrder([
  ['id', StringSchema],
  ['workspace_id', StringSchema],
  ['project_id', StringSchema],
  ['number', NumberSchema],
  ['title', StringSchema],
  ['status', StringSchema],
  ['priority', StringSchema],
  ['assignee_id', NS],
  ['labels', StringSchema],
  ['parent_id', NS],
  ['type_id', NS],
  ['status_id', NS],
  ['status_category', NS],
  ['sprint_id', NS],
  ['created_by_id', StringSchema],
  ['author_kind', NS],
  ['created_at', NumberSchema],
  ['updated_at', NumberSchema],
  ['completed_at', NN],
  ['needs_audit', BooleanSchema],
  ['project_key', NS],
  ['project_name', NS],
  ['type_key', NS],
  ['type_name', NS],
  ['status_key', NS],
  ['status_name', NS],
])
const IssueListItem = extendStructInOrder(IssueFields, [
  ['body', Schema.optional(StringSchema)],
  ['assignee_name', NS],
  ['customFields', array(FieldValue)],
  ['rollup', Schema.optional(Rollup)],
  ['url', StringSchema],
])
const IssueDetail = extendStructInOrder(IssueFields, [
  ['body', StringSchema],
  ['rollup', Rollup],
  ['links', array(IssueLink)],
  ['customFields', array(FieldValue)],
  ['url', StringSchema],
])
const PrioritizedIssue = structInOrder([
  ['id', StringSchema],
  ['title', StringSchema],
  ['status', StringSchema],
  ['priority', StringSchema],
  ['project_id', StringSchema],
  ['number', NumberSchema],
  ['status_id', NS],
  ['status_category', NS],
  ['_score', NumberSchema],
  ['_score_breakdown', Schema.Struct({ centrality: NumberSchema, priority: NumberSchema, story_points: NumberSchema })],
  ['needsGrooming', Schema.optional(Schema.Literal(true))],
  ['missingCriteria', Schema.optional(array(StringSchema))],
])
const AgingWipStatus = Schema.Literals(['in_progress', 'in_review'])
const FlowMetrics = structInOrder([
  ['leadTime', Distribution],
  ['leadTimeExcluded', NumberSchema],
  ['cycleTime', Distribution],
  [
    'wipOverTime',
    array(
      structInOrder([
        ['date', StringSchema],
        ['count', NumberSchema],
      ]),
    ),
  ],
  ['throughputOverTime', array(Schema.Struct({ bucketStart: StringSchema, count: NumberSchema }))],
  [
    'bugShareOverTime',
    array(
      structInOrder([
        ['bucketStart', StringSchema],
        ['total', NumberSchema],
        ['bugCount', NumberSchema],
        ['bugSharePercent', NN],
      ]),
    ),
  ],
  ['bugTypeTracked', BooleanSchema],
  ['reviewLatency', Distribution],
  ['reviewLatencyOverTime', array(Schema.Struct({ bucketStart: StringSchema, p50: NN }))],
  ['humanInterventions', Distribution],
  ['autonomyRatio', Distribution],
  [
    'cfdOverTime',
    array(
      structInOrder([
        ['bucketStart', StringSchema],
        ['backlogTodo', NumberSchema],
        ['inProgress', NumberSchema],
        ['inReview', NumberSchema],
        ['done', NumberSchema],
      ]),
    ),
  ],
  ['timeInProgress', Distribution],
  [
    'arrivalVsCompletionOverTime',
    array(
      structInOrder([
        ['bucketStart', StringSchema],
        ['created', NumberSchema],
        ['completed', NumberSchema],
        ['net', NumberSchema],
      ]),
    ),
  ],
  ['flowEfficiency', Distribution],
  [
    'agingWip',
    array(
      structInOrder([
        ['id', StringSchema],
        ['status', AgingWipStatus],
        ['ageSeconds', NumberSchema],
      ]),
    ),
  ],
  [
    'factoryHealth',
    structInOrder([
      ['leaseExpiries', NumberSchema],
      ['abandonedClaims', NumberSchema],
      ['gateRejections', NumberSchema],
      ['wipCapPressure', NumberSchema],
    ]),
  ],
])
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

const BatchIssue = Schema.Struct({
  ...IssueFields,
  body: Schema.optional(StringSchema),
  customFields: array(FieldValue),
  url: StringSchema,
})
const apiResultEntries = [
  ['apiAuthenticate', ApiPrincipal],
  ['apiResolveWorkspace', ApiWorkspace],
  [
    'apiListWorkspaces',
    array(
      structInOrder([
        ['id', StringSchema],
        ['name', StringSchema],
        ['slug', StringSchema],
        ['role', StringSchema],
        ['createdAt', NumberSchema],
      ]),
    ),
  ],
  ['apiUserBootstrap', ApiUserBootstrap],
  ['apiCreateWorkspace', Schema.Struct({ id: StringSchema, name: StringSchema, slug: StringSchema })],
  ['apiCreateUserToken', Schema.Struct({ token: StringSchema })],
  ['apiDeleteUserToken', Ok],
  ['apiRegisterAgent', Session],
  [
    'apiStartWork',
    structInOrder([
      ['sessionId', StringSchema],
      ['lease', Lease],
      ['claimedFiles', array(Claim)],
    ]),
  ],
  ['apiHeartbeatAgent', Session],
  ['apiEndAgent', Session],
  ['apiFinishWork', Session],
  [
    'apiListActiveAgents',
    Schema.Struct({
      items: array(Schema.Struct({ ...SessionFields, issueRef: NS, live: BooleanSchema })),
    }),
  ],
  ['apiPostMessage', Message],
  ['apiListMessages', Schema.Struct({ items: array(Message), nextCursor: NS })],
  ['apiClaimFiles', Claims],
  [
    'apiReleaseFiles',
    structInOrder([
      ['released', array(ReleasedClaim)],
      ['count', NumberSchema],
    ]),
  ],
  [
    'apiListFileClaims',
    Schema.Struct({
      items: array(
        extendStructInOrder(ClaimFields, [
          ['releaseReason', NS],
          ['issueRef', StringSchema],
          ['live', BooleanSchema],
        ]),
      ),
    }),
  ],
  ['apiClaimIssue', Lease],
  ['apiReleaseIssue', Ok],
  [
    'apiListIssueLeases',
    Schema.Struct({
      items: array(
        structInOrder([
          ['id', StringSchema],
          ['issueId', StringSchema],
          ['issueRef', StringSchema],
          ['agentSessionId', StringSchema],
          ['agentName', StringSchema],
          ['claimedAt', NumberSchema],
          ['live', BooleanSchema],
        ]),
      ),
    }),
  ],
  ['apiListComments', array(Comment)],
  ['apiAddComment', Id],
  ['apiUpdateComment', Ok],
  ['apiDeleteComment', Ok],
  ['apiListAttachments', array(Attachment)],
  ['apiCreateLinkAttachment', Schema.Struct({ id: StringSchema, kind: Schema.Literals(['wiki_ref', 'url']) })],
  ['apiGetAttachment', Attachment],
  ['apiDeleteAttachment', Schema.Struct({ r2Key: StringSchema })],
  ['apiSetAttachmentReviewStatus', Ok],
  ['apiListCustomFieldDefs', array(CustomField)],
  [
    'apiCreateCustomFieldDef',
    Schema.Struct({
      id: StringSchema,
      key: StringSchema,
      label: StringSchema,
      type: StringSchema,
    }),
  ],
  ['apiUpdateCustomFieldDef', Ok],
  ['apiDeleteCustomFieldDef', Ok],
  ['apiListGroups', array(Group)],
  ['apiGetGroup', GroupDetail],
  [
    'apiListMemberGroups',
    array(
      structInOrder([
        ['userId', StringSchema],
        ['groups', array(Named)],
      ]),
    ),
  ],
  [
    'apiCreateGroup',
    structInOrder([
      ['id', StringSchema],
      ['name', StringSchema],
      ['description', NS],
    ]),
  ],
  ['apiUpdateGroup', Ok],
  ['apiDeleteGroup', Ok],
  ['apiAddGroupMember', Ok],
  ['apiRemoveGroupMember', Ok],
  ['apiSetGroupGrant', Ok],
  ['apiRemoveGroupGrant', Ok],
  ['apiListSprints', Schema.Struct({ items: array(Sprint) })],
  ['apiGetSprint', Sprint],
  ['apiCreateSprint', Id],
  ['apiUpdateSprint', Ok],
  ['apiCompleteSprint', Ok],
  ['apiDeleteSprint', Ok],
  [
    'apiMoveIssuesToSprint',
    Schema.Union([
      array(Schema.Never),
      structInOrder([
        ['ok', BooleanSchema],
        ['count', NumberSchema],
      ]),
    ]),
  ],
  ['apiListFeedback', array(Feedback)],
  ['apiUpdateFeedbackStatus', Ok],
  ['apiConvertFeedbackToIssue', CreatedIssue],
  ['apiBulkMarkReviewed', Schema.Struct({ updated: NumberSchema })],
  [
    'apiBulkConvertToIssue',
    structInOrder([
      ['id', StringSchema],
      ['number', Schema.optional(NumberSchema)],
      ['convertedCount', NumberSchema],
    ]),
  ],
  ['apiGetFeedbackSummary', FeedbackSummary],
  ['apiCreateFeedbackSource', Schema.Struct({ id: StringSchema, token: StringSchema })],
  ['apiListFeedbackSources', array(FeedbackSource)],
  ['apiGetFeedbackSource', Schema.Struct({ ...FeedbackSourceFields, projectId: StringSchema })],
  ['apiUpdateFeedbackSource', Ok],
  ['apiRotateFeedbackSourceToken', Schema.Struct({ token: StringSchema })],
  ['apiRevokeFeedbackSource', Ok],
  ['apiGetCodeHeatmap', Heatmap],
  ['apiGetFlowMetrics', FlowMetrics],
  ['apiListProjectActivity', array(Activity)],
  [
    'apiComposePlaybook',
    structInOrder([
      ['name', StringSchema],
      ['variant', StringSchema],
      ['directive', StringSchema],
    ]),
  ],
  ['apiListProjects', array(ProjectSummary)],
  ['apiListProjectsInWorkspace', array(Project)],
  ['apiGetProject', Project],
  ['apiGetProjectBySlug', Project],
  [
    'apiCreateProject',
    structInOrder([
      ['id', StringSchema],
      ['name', StringSchema],
      ['key', StringSchema],
      ['slug', StringSchema],
    ]),
  ],
  ['apiUpdateProject', Ok],
  ['apiDeleteProject', Ok],
  ['apiCreateLink', Id],
  ['apiDeleteLink', Ok],
  ['apiListLinksForIssue', array(IssueLink)],
  [
    'apiListIssues',
    structInOrder([
      ['items', array(IssueListItem)],
      ['total', NN],
      ['nextCursor', NS],
    ]),
  ],
  ['apiResolveIssueIdParam', StringSchema],
  ['apiGetIssue', IssueDetail],
  [
    'apiGetIssuesBatch',
    Schema.Struct({
      items: array(BatchIssue),
      missing: array(StringSchema),
    }),
  ],
  ['apiCreateIssue', Schema.Struct({ id: StringSchema, number: NumberSchema })],
  ['apiUpdateIssue', Ok],
  ['apiDeleteIssue', Ok],
  [
    'apiGetPrioritizedIssues',
    structInOrder([
      ['issues', array(PrioritizedIssue)],
      ['droppedNotReady', Schema.optional(NumberSchema)],
      ['degraded', Schema.optional(BooleanSchema)],
    ]),
  ],
  [
    'apiSearchIssues',
    array(
      structInOrder([
        ['id', StringSchema],
        ['number', NumberSchema],
        ['title', StringSchema],
        ['status', StringSchema],
        ['priority', StringSchema],
        ['project_id', NS],
        ['project_key', NS],
        ['project_name', NS],
      ]),
    ),
  ],
  ['apiListTaskStatuses', array(TaskStatus)],
  ['apiCreateTaskStatus', Keyed],
  ['apiUpdateTaskStatus', Ok],
  ['apiDeleteTaskStatus', Ok],
  ['apiCreateTaskType', Keyed],
  ['apiListTaskTypes', array(TaskType)],
  ['apiUpdateTaskType', Ok],
  ['apiDeleteTaskType', Ok],
  ['apiCreateShareToken', Schema.Struct({ token: StringSchema, url: StringSchema })],
  ['apiRevokeShareToken', Schema.Void],
  ['apiUpdateWorkspace', Ok],
  [
    'apiGetWorkspaceWithMembers',
    structInOrder([
      ['id', StringSchema],
      ['name', StringSchema],
      ['slug', StringSchema],
      ['currentUserRole', Schema.optional(StringSchema)],
      [
        'members',
        array(
          structInOrder([
            ['id', StringSchema],
            ['name', StringSchema],
            ['email', StringSchema],
            ['avatarUrl', NS],
            ['role', StringSchema],
            ['joinedAt', NumberSchema],
          ]),
        ),
      ],
    ]),
  ],
  [
    'apiListTokens',
    array(
      structInOrder([
        ['id', StringSchema],
        ['name', StringSchema],
        ['scopes', array(StringSchema)],
        ['lastUsedAt', NN],
        ['expiresAt', NN],
        ['createdAt', NumberSchema],
      ]),
    ),
  ],
  ['apiInviteMember', Ok],
  ['apiRemoveMember', Ok],
  ['apiUpdateMemberRole', Ok],
  ['apiDeleteWorkspace', Ok],
  [
    'apiGetWorkspaceMcpInfo',
    structInOrder([
      ['mcpUrl', StringSchema],
      ['workspaceId', StringSchema],
      ['workspaceSlug', StringSchema],
      ['mcpAddCommandTemplate', StringSchema],
    ]),
  ],
  ['apiGetWorkspaceBrand', Brand],
  ['apiUpdateWorkspaceBrand', Brand],
  ['apiDeleteWorkspaceLogo', Ok],
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
  ['apiDeleteStoredAttachment', Schema.Void],
  [
    'apiCreateToken',
    structInOrder([
      ['id', StringSchema],
      ['token', StringSchema],
      ['name', StringSchema],
      ['scopes', array(StringSchema)],
      ['expiresAt', NN],
    ]),
  ],
  ['apiRevokeToken', Ok],
  ['apiResolveProjectIdParam', StringSchema],
  ['apiResolveVisibleProjectIdParam', StringSchema],
  [
    'apiListConnectorGrants',
    array(
      structInOrder([
        ['id', StringSchema],
        ['client', StringSchema],
        ['clientId', StringSchema],
        ['scopes', array(StringSchema)],
        ['grantedAt', NumberSchema],
        ['expiresAt', NumberSchema],
      ]),
    ),
  ],
  ['apiRevokeConnectorGrant', Ok],
  [
    'apiListPlaybooks',
    array(
      structInOrder([
        ['name', StringSchema],
        ['title', StringSchema],
        ['description', StringSchema],
        ['whenToUse', StringSchema],
      ]),
    ),
  ],
  [
    'apiGetPlaybook',
    structInOrder([
      ['name', StringSchema],
      ['title', StringSchema],
      ['description', StringSchema],
      ['whenToUse', StringSchema],
      ['content', StringSchema],
    ]),
  ],
  [
    'apiGetWorkflow',
    Schema.Union([
      Schema.Struct({ unchanged: Schema.Literal(true), version: StringSchema }),
      structInOrder([
        ['title', StringSchema],
        ['description', StringSchema],
        ['content', StringSchema],
        ['version', StringSchema],
      ]),
    ]),
  ],
  [
    'apiListBrokenWikiLinks',
    array(
      Schema.Struct({
        linkId: StringSchema,
        sourcePageId: StringSchema,
        sourceSlug: StringSchema,
        sourceTitle: StringSchema,
        targetTitle: StringSchema,
      }),
    ),
  ],
  [
    'apiBackfillWikiLinks',
    structInOrder([
      ['processed', NumberSchema],
      [
        'nextCursor',
        Schema.NullOr(
          structInOrder([
            ['updatedAt', NumberSchema],
            ['id', StringSchema],
          ]),
        ),
      ],
      ['pagesProcessed', NumberSchema],
    ]),
  ],
  [
    'apiPurgeExpiredWikiPages',
    structInOrder([
      ['purgedCount', NumberSchema],
      ['purgedIds', array(StringSchema)],
      ['moreExpired', BooleanSchema],
    ]),
  ],
] as const

/** Closed operation-specific public outputs. These codecs import no domain or storage implementation. */
export const ApiResults = fieldsInOrder(apiResultEntries)
