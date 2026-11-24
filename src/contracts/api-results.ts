import { Schema } from 'effect'

import { ApiPrincipal, ApiUserBootstrap, ApiWorkspace } from './api-auth.ts'
import { ReviewStatusSchema } from './review-targets.ts'

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

const SessionFields = {
  id: StringSchema,
  workspaceId: StringSchema,
  issueId: NS,
  tokenId: NS,
  name: StringSchema,
  status: Schema.Literals(['active', 'ended']),
  startedAt: NumberSchema,
  lastHeartbeatAt: NumberSchema,
  endedAt: NN,
}
const Session = Schema.Struct(SessionFields)
const Lease = Schema.Struct({
  id: StringSchema,
  workspaceId: StringSchema,
  issueId: StringSchema,
  agentSessionId: StringSchema,
  claimedAt: NumberSchema,
  releasedAt: NN,
  releaseReason: NS,
})
const ClaimFields = {
  id: StringSchema,
  workspaceId: StringSchema,
  issueId: StringSchema,
  agentId: NS,
  path: StringSchema,
  claimedAt: NumberSchema,
  releasedAt: NN,
}
const Claim = Schema.Struct(ClaimFields)
const Message = Schema.Struct({
  id: StringSchema,
  workspaceId: StringSchema,
  scope: StringSchema,
  agentId: NS,
  body: StringSchema,
  createdAt: NumberSchema,
})
const ReleasedClaim = Schema.Struct({ ...ClaimFields, releaseReason: NS })
const ActiveClaim = Schema.Struct({ ...ClaimFields, releaseReason: NS, live: BooleanSchema })
const Claims = Schema.Struct({
  created: array(Claim),
  overridden: array(ActiveClaim),
  reclaimed: array(ActiveClaim),
})
const Comment = Schema.Struct({
  id: StringSchema,
  body: StringSchema,
  created_at: NumberSchema,
  updated_at: NumberSchema,
  author_id: StringSchema,
  author_name: StringSchema,
  author_email: StringSchema,
})
const Attachment = Schema.Struct({
  id: StringSchema,
  kind: Schema.Literals(['file', 'wiki_ref', 'url']),
  filename: StringSchema,
  contentType: StringSchema,
  size: NumberSchema,
  url: NS,
  createdAt: NumberSchema,
  reviewStatus: Schema.NullOr(ReviewStatusSchema),
  wikiPage: Schema.NullOr(Schema.Struct({ id: StringSchema, title: NS, url: StringSchema })),
})
const CustomField = Schema.Struct({
  id: StringSchema,
  workspaceId: StringSchema,
  projectId: NS,
  key: StringSchema,
  label: StringSchema,
  type: Schema.Literals(['text', 'number', 'select', 'date', 'user']),
  options: Schema.NullOr(array(StringSchema)),
  createdAt: NumberSchema,
  isInternal: BooleanSchema,
})
const GroupFields = { id: StringSchema, name: StringSchema, description: NS, createdAt: NumberSchema }
const Group = Schema.Struct({ ...GroupFields, memberCount: NumberSchema, grantCount: NumberSchema })
const GroupDetail = Schema.Struct({
  ...GroupFields,
  workspaceId: StringSchema,
  members: array(
    Schema.Struct({
      userId: StringSchema,
      email: StringSchema,
      name: StringSchema,
      addedAt: NumberSchema,
      addedBy: StringSchema,
    }),
  ),
  grants: array(
    Schema.Struct({
      projectId: StringSchema,
      projectName: StringSchema,
      projectKey: StringSchema,
      role: Schema.Literals(['viewer', 'member', 'admin']),
    }),
  ),
})
const Sprint = Schema.Struct({
  id: StringSchema,
  workspaceId: StringSchema,
  projectId: StringSchema,
  name: StringSchema,
  goal: NS,
  status: Schema.Literals(['planned', 'active', 'completed']),
  startDate: NN,
  endDate: NN,
  createdAt: NumberSchema,
  updatedAt: NumberSchema,
})
const Feedback = Schema.Struct({
  id: StringSchema,
  sourceId: StringSchema,
  sourceName: NS,
  rating: NN,
  ratingScale: NS,
  body: NS,
  submitterLabel: NS,
  sourceUrl: NS,
  appVersion: NS,
  status: StringSchema,
  linkedIssueId: NS,
  createdAt: NumberSchema,
})
const FeedbackSourceFields = {
  id: StringSchema,
  name: StringSchema,
  description: NS,
  isActive: BooleanSchema,
  allowedOrigins: Schema.NullOr(array(StringSchema)),
  tokenPreview: StringSchema,
  createdAt: NumberSchema,
  revokedAt: NN,
}
const FeedbackSource = Schema.Struct(FeedbackSourceFields)
const FeedbackSummary = array(
  Schema.Struct({
    sourceId: StringSchema,
    sourceName: NS,
    totalCount: NumberSchema,
    versions: array(
      Schema.Struct({
        appVersion: NS,
        totalCount: NumberSchema,
        withCommentCount: NumberSchema,
        thumbsUpPct: NN,
        avgFiveStar: NN,
        lastSeenAt: NumberSchema,
      }),
    ),
  }),
)
const Activity = Schema.Struct({
  type: StringSchema,
  actor: NS,
  entity_type: StringSchema,
  entity_id: StringSchema,
  entity_ref: StringSchema,
  summary: StringSchema,
  created_at: NumberSchema,
})
const Brand = Schema.Struct({ displayName: NS, accent: NS, onAccent: NS, fontFamily: NS, fontUrl: NS, logoUrl: NS })
const Distribution = Schema.Struct({ count: NumberSchema, avg: NN, p50: NN, p90: NN })
const HeatmapEntryFields = { path: StringSchema, segment: StringSchema, isLeaf: BooleanSchema }
const Heatmap = Schema.Union([
  Schema.Struct({
    prefix: StringSchema,
    mode: Schema.Literal('claims'),
    totalDistinctIssues: NumberSchema,
    entries: array(
      Schema.Struct({ ...HeatmapEntryFields, distinctIssueCount: NumberSchema, claimCount: NumberSchema }),
    ),
  }),
  Schema.Struct({
    prefix: StringSchema,
    mode: Schema.Literal('contention'),
    totalDistinctIssues: NumberSchema,
    entries: array(
      Schema.Struct({ ...HeatmapEntryFields, distinctRejectedIssueCount: NumberSchema, conflictCount: NumberSchema }),
    ),
  }),
])
const Project = Schema.Struct({
  id: StringSchema,
  workspaceId: StringSchema,
  name: StringSchema,
  key: StringSchema,
  description: NS,
  createdAt: NumberSchema,
  updatedAt: NumberSchema,
  agentWipLimit: NN,
  slug: NS,
  archivedAt: NN,
})
const ProjectSummary = Schema.Struct({
  id: StringSchema,
  name: StringSchema,
  key: StringSchema,
  slug: NS,
  description: NS,
  workspace_id: StringSchema,
  workspace_name: StringSchema,
  workspace_slug: StringSchema,
  open_issue_count: NumberSchema,
  backlog_issue_count: NumberSchema,
  archived_at: NN,
  created_at: NumberSchema,
  updated_at: NumberSchema,
})
const TaskType = Schema.Struct({
  id: StringSchema,
  workspace_id: StringSchema,
  key: StringSchema,
  name: StringSchema,
  color: NS,
  icon: NS,
  position: NumberSchema,
  is_default: NumberSchema,
})
const TaskStatus = Schema.Struct({
  id: StringSchema,
  workspace_id: StringSchema,
  key: StringSchema,
  name: StringSchema,
  color: NS,
  position: NumberSchema,
  is_default: NumberSchema,
  is_review_step: NumberSchema,
  category: Schema.Literals(['todo', 'in_progress', 'done', 'cancelled']),
})
const IssueLink = Schema.Struct({
  id: StringSchema,
  type: Schema.Literals(['blocks', 'blocked_by', 'relates_to', 'duplicates']),
  linkedIssueId: StringSchema,
  linkedIssueTitle: StringSchema,
  linkedIssueNumber: NumberSchema,
  linkedIssueProjectKey: StringSchema,
  linkedIssueStatusCategory: StringSchema,
  createdById: StringSchema,
  createdAt: NumberSchema,
})
const Rollup = Schema.Struct({
  total: NumberSchema,
  byStatus: Schema.Record(StringSchema, NumberSchema),
  done: NumberSchema,
  remaining: NumberSchema,
})
const FieldValue = Schema.Struct({ key: StringSchema, label: StringSchema, type: StringSchema, value: StringSchema })
const IssueFields = {
  id: StringSchema,
  workspace_id: StringSchema,
  project_id: StringSchema,
  number: NumberSchema,
  title: StringSchema,
  status: StringSchema,
  priority: StringSchema,
  assignee_id: NS,
  labels: StringSchema,
  parent_id: NS,
  type_id: NS,
  status_id: NS,
  status_category: NS,
  sprint_id: NS,
  created_by_id: StringSchema,
  author_kind: NS,
  created_at: NumberSchema,
  updated_at: NumberSchema,
  completed_at: NN,
  needs_audit: BooleanSchema,
  project_key: NS,
  project_name: NS,
  type_key: NS,
  type_name: NS,
  status_key: NS,
  status_name: NS,
}
const IssueListItem = Schema.Struct({
  ...IssueFields,
  body: Schema.optional(StringSchema),
  assignee_name: NS,
  customFields: array(FieldValue),
  rollup: Schema.optional(Rollup),
  url: StringSchema,
})
const IssueDetail = Schema.Struct({
  ...IssueFields,
  body: StringSchema,
  rollup: Rollup,
  links: array(IssueLink),
  customFields: array(FieldValue),
  url: StringSchema,
})
const PrioritizedIssue = Schema.Struct({
  id: StringSchema,
  title: StringSchema,
  status: StringSchema,
  priority: StringSchema,
  project_id: StringSchema,
  number: NumberSchema,
  status_id: NS,
  status_category: NS,
  _score: NumberSchema,
  _score_breakdown: Schema.Struct({ centrality: NumberSchema, priority: NumberSchema, story_points: NumberSchema }),
  needsGrooming: Schema.optional(Schema.Literal(true)),
  missingCriteria: Schema.optional(array(StringSchema)),
})
const FlowMetrics = Schema.Struct({
  leadTime: Distribution,
  leadTimeExcluded: NumberSchema,
  cycleTime: Distribution,
  wipOverTime: array(Schema.Struct({ date: StringSchema, count: NumberSchema })),
  throughputOverTime: array(Schema.Struct({ bucketStart: StringSchema, count: NumberSchema })),
  bugShareOverTime: array(
    Schema.Struct({ bucketStart: StringSchema, total: NumberSchema, bugCount: NumberSchema, bugSharePercent: NN }),
  ),
  bugTypeTracked: BooleanSchema,
  reviewLatency: Distribution,
  reviewLatencyOverTime: array(Schema.Struct({ bucketStart: StringSchema, p50: NN })),
  humanInterventions: Distribution,
  autonomyRatio: Distribution,
  cfdOverTime: array(
    Schema.Struct({
      bucketStart: StringSchema,
      backlogTodo: NumberSchema,
      inProgress: NumberSchema,
      inReview: NumberSchema,
      done: NumberSchema,
    }),
  ),
  timeInProgress: Distribution,
  arrivalVsCompletionOverTime: array(
    Schema.Struct({ bucketStart: StringSchema, created: NumberSchema, completed: NumberSchema, net: NumberSchema }),
  ),
  flowEfficiency: Distribution,
  agingWip: array(
    Schema.Struct({
      id: StringSchema,
      status: Schema.Literals(['in_progress', 'in_review']),
      ageSeconds: NumberSchema,
    }),
  ),
  factoryHealth: Schema.Struct({
    leaseExpiries: NumberSchema,
    abandonedClaims: NumberSchema,
    gateRejections: NumberSchema,
    wipCapPressure: NumberSchema,
  }),
})
const Freshness = Schema.NullOr(
  Schema.Struct({ state: Schema.Literals(['fresh', 'stale', 'unverified']), staleSince: NN }),
)
const WikiMetadataFields = {
  type: NS,
  tags: array(StringSchema),
  status: NS,
  verified_at: NN,
  verified_by: NS,
  owners: array(StringSchema),
  verify_interval: NN,
  is_template: BooleanSchema,
}
const WikiIdentityFields = { id: StringSchema, slug: StringSchema, title: StringSchema, project_id: NS }
const WikiSummaryFields = { ...WikiIdentityFields, parent_id: NS, updated_at: NumberSchema, ...WikiMetadataFields }
const WikiSummary = Schema.Struct({ ...WikiSummaryFields, url: StringSchema })
const WikiPage = Schema.Struct({
  ...WikiSummaryFields,
  content: StringSchema,
  version: Schema.optional(NumberSchema),
  revisionId: NS,
  url: StringSchema,
  freshness: Freshness,
})
const WikiRevisionFields = {
  id: StringSchema,
  title: StringSchema,
  summary: NS,
  author_id: StringSchema,
  created_at: NumberSchema,
}
interface WikiTreeNode {
  readonly id: string
  readonly slug: string
  readonly title: string
  readonly url: string
  readonly type: string | null
  readonly children: WikiTreeNode[]
}
const WikiTreeNode: Schema.Codec<WikiTreeNode> = Schema.suspend(() =>
  Schema.Struct({
    id: StringSchema,
    slug: StringSchema,
    title: StringSchema,
    url: StringSchema,
    type: NS,
    children: array(WikiTreeNode),
  }),
)
const WikiDraft = Schema.NullOr(
  Schema.Struct({ title: StringSchema, content: StringSchema, baseRevisionId: NS, updatedAt: NumberSchema }),
)
const WikiChange = Schema.Struct({
  id: StringSchema,
  action: Schema.Literals(['created', 'updated', 'deleted']),
  pageId: StringSchema,
  slug: NS,
  title: NS,
  projectId: NS,
  actorId: NS,
  createdAt: NumberSchema,
  deletedPageIds: Schema.NullOr(array(StringSchema)),
  deletedPageIdsTruncated: BooleanSchema,
})

/** Closed operation-specific public outputs. These codecs import no domain or storage implementation. */
export const ApiResults = {
  apiAuthenticate: ApiPrincipal,
  apiResolveWorkspace: ApiWorkspace,
  apiListWorkspaces: array(
    Schema.Struct({
      id: StringSchema,
      name: StringSchema,
      slug: StringSchema,
      role: StringSchema,
      createdAt: NumberSchema,
    }),
  ),
  apiUserBootstrap: ApiUserBootstrap,
  apiCreateWorkspace: Schema.Struct({ id: StringSchema, name: StringSchema, slug: StringSchema }),
  apiCreateUserToken: Schema.Struct({ token: StringSchema }),
  apiDeleteUserToken: Ok,
  apiRegisterAgent: Session,
  apiStartWork: Schema.Struct({ sessionId: StringSchema, lease: Lease, claimedFiles: array(Claim) }),
  apiHeartbeatAgent: Session,
  apiEndAgent: Session,
  apiFinishWork: Session,
  apiListActiveAgents: Schema.Struct({
    items: array(Schema.Struct({ ...SessionFields, issueRef: NS, live: BooleanSchema })),
  }),
  apiPostMessage: Message,
  apiListMessages: Schema.Struct({ items: array(Message), nextCursor: NS }),
  apiClaimFiles: Claims,
  apiReleaseFiles: Schema.Struct({ released: array(ReleasedClaim), count: NumberSchema }),
  apiListFileClaims: Schema.Struct({
    items: array(Schema.Struct({ ...ClaimFields, releaseReason: NS, issueRef: StringSchema, live: BooleanSchema })),
  }),
  apiClaimIssue: Lease,
  apiReleaseIssue: Ok,
  apiListIssueLeases: Schema.Struct({
    items: array(
      Schema.Struct({
        id: StringSchema,
        issueId: StringSchema,
        issueRef: StringSchema,
        agentSessionId: StringSchema,
        agentName: StringSchema,
        claimedAt: NumberSchema,
        live: BooleanSchema,
      }),
    ),
  }),
  apiListComments: array(Comment),
  apiAddComment: Id,
  apiUpdateComment: Ok,
  apiDeleteComment: Ok,
  apiListAttachments: array(Attachment),
  apiCreateLinkAttachment: Schema.Struct({ id: StringSchema, kind: Schema.Literals(['wiki_ref', 'url']) }),
  apiGetAttachment: Attachment,
  apiDeleteAttachment: Schema.Struct({ r2Key: StringSchema }),
  apiSetAttachmentReviewStatus: Ok,
  apiListCustomFieldDefs: array(CustomField),
  apiCreateCustomFieldDef: Schema.Struct({
    id: StringSchema,
    key: StringSchema,
    label: StringSchema,
    type: StringSchema,
  }),
  apiUpdateCustomFieldDef: Ok,
  apiDeleteCustomFieldDef: Ok,
  apiListGroups: array(Group),
  apiGetGroup: GroupDetail,
  apiListMemberGroups: array(Schema.Struct({ userId: StringSchema, groups: array(Named) })),
  apiCreateGroup: Schema.Struct({ id: StringSchema, name: StringSchema, description: NS }),
  apiUpdateGroup: Ok,
  apiDeleteGroup: Ok,
  apiAddGroupMember: Ok,
  apiRemoveGroupMember: Ok,
  apiSetGroupGrant: Ok,
  apiRemoveGroupGrant: Ok,
  apiListSprints: Schema.Struct({ items: array(Sprint) }),
  apiGetSprint: Sprint,
  apiCreateSprint: Id,
  apiUpdateSprint: Ok,
  apiCompleteSprint: Ok,
  apiDeleteSprint: Ok,
  apiMoveIssuesToSprint: Schema.Union([array(Schema.Never), Schema.Struct({ ok: BooleanSchema, count: NumberSchema })]),
  apiListFeedback: array(Feedback),
  apiUpdateFeedbackStatus: Ok,
  apiConvertFeedbackToIssue: CreatedIssue,
  apiBulkMarkReviewed: Schema.Struct({ updated: NumberSchema }),
  apiBulkConvertToIssue: Schema.Struct({
    id: StringSchema,
    number: Schema.optional(NumberSchema),
    convertedCount: NumberSchema,
  }),
  apiGetFeedbackSummary: FeedbackSummary,
  apiCreateFeedbackSource: Schema.Struct({ id: StringSchema, token: StringSchema }),
  apiListFeedbackSources: array(FeedbackSource),
  apiGetFeedbackSource: Schema.Struct({ ...FeedbackSourceFields, projectId: StringSchema }),
  apiUpdateFeedbackSource: Ok,
  apiRotateFeedbackSourceToken: Schema.Struct({ token: StringSchema }),
  apiRevokeFeedbackSource: Ok,
  apiGetCodeHeatmap: Heatmap,
  apiGetFlowMetrics: FlowMetrics,
  apiListProjectActivity: array(Activity),
  apiComposePlaybook: Schema.Struct({ name: StringSchema, variant: StringSchema, directive: StringSchema }),
  apiListProjects: array(ProjectSummary),
  apiListProjectsInWorkspace: array(Project),
  apiGetProject: Project,
  apiGetProjectBySlug: Project,
  apiCreateProject: Schema.Struct({ id: StringSchema, name: StringSchema, key: StringSchema, slug: StringSchema }),
  apiUpdateProject: Ok,
  apiDeleteProject: Ok,
  apiCreateLink: Id,
  apiDeleteLink: Ok,
  apiListLinksForIssue: array(IssueLink),
  apiListIssues: Schema.Struct({ items: array(IssueListItem), total: NN, nextCursor: NS }),
  apiResolveIssueIdParam: StringSchema,
  apiGetIssue: IssueDetail,
  apiGetIssuesBatch: Schema.Struct({
    items: array(
      Schema.Struct({
        ...IssueFields,
        body: Schema.optional(StringSchema),
        customFields: array(FieldValue),
        url: StringSchema,
      }),
    ),
    missing: array(StringSchema),
  }),
  apiCreateIssue: Schema.Struct({ id: StringSchema, number: NumberSchema }),
  apiUpdateIssue: Ok,
  apiDeleteIssue: Ok,
  apiGetPrioritizedIssues: Schema.Struct({
    issues: array(PrioritizedIssue),
    droppedNotReady: Schema.optional(NumberSchema),
    degraded: Schema.optional(BooleanSchema),
  }),
  apiSearchIssues: array(
    Schema.Struct({
      id: StringSchema,
      number: NumberSchema,
      title: StringSchema,
      status: StringSchema,
      priority: StringSchema,
      project_id: NS,
      project_key: NS,
      project_name: NS,
    }),
  ),
  apiListTaskStatuses: array(TaskStatus),
  apiCreateTaskStatus: Keyed,
  apiUpdateTaskStatus: Ok,
  apiDeleteTaskStatus: Ok,
  apiCreateTaskType: Keyed,
  apiListTaskTypes: array(TaskType),
  apiUpdateTaskType: Ok,
  apiDeleteTaskType: Ok,
  apiCreateShareToken: Schema.Struct({ token: StringSchema, url: StringSchema }),
  apiRevokeShareToken: Schema.Void,
  apiUpdateWorkspace: Ok,
  apiGetWorkspaceWithMembers: Schema.Struct({
    id: StringSchema,
    name: StringSchema,
    slug: StringSchema,
    currentUserRole: Schema.optional(StringSchema),
    members: array(
      Schema.Struct({
        id: StringSchema,
        name: StringSchema,
        email: StringSchema,
        avatarUrl: NS,
        role: StringSchema,
        joinedAt: NumberSchema,
      }),
    ),
  }),
  apiListTokens: array(
    Schema.Struct({
      id: StringSchema,
      name: StringSchema,
      scopes: array(StringSchema),
      lastUsedAt: NN,
      expiresAt: NN,
      createdAt: NumberSchema,
    }),
  ),
  apiInviteMember: Ok,
  apiRemoveMember: Ok,
  apiUpdateMemberRole: Ok,
  apiDeleteWorkspace: Ok,
  apiGetWorkspaceMcpInfo: Schema.Struct({
    mcpUrl: StringSchema,
    workspaceId: StringSchema,
    workspaceSlug: StringSchema,
    mcpAddCommandTemplate: StringSchema,
  }),
  apiGetWorkspaceBrand: Brand,
  apiUpdateWorkspaceBrand: Brand,
  apiDeleteWorkspaceLogo: Ok,
  apiListWikiPages: array(WikiSummary),
  apiSearchWiki: array(
    Schema.Struct({
      ...WikiIdentityFields,
      type: NS,
      tags: array(StringSchema),
      status: NS,
      verified_at: NN,
      verified_by: NS,
      owners: array(StringSchema),
      verify_interval: NN,
      excerpt: StringSchema,
      rank: NumberSchema,
      freshness: Freshness,
    }),
  ),
  apiGetWikiPage: WikiPage,
  apiGetWikiBacklinks: array(
    Schema.Struct({
      linkId: StringSchema,
      pageId: StringSchema,
      slug: StringSchema,
      title: StringSchema,
      url: StringSchema,
      snippet: NS,
    }),
  ),
  apiCreateWikiPage: Schema.Struct({
    id: StringSchema,
    slug: StringSchema,
    projectId: NS,
    url: StringSchema,
    type: NS,
    tags: array(StringSchema),
    status: NS,
    verifiedAt: NN,
    verifiedBy: NS,
    owners: array(StringSchema),
    verifyInterval: NN,
    isTemplate: BooleanSchema,
  }),
  apiUpdateWikiPage: Schema.Struct({ ok: BooleanSchema, url: StringSchema }),
  apiVerifyWikiPage: Schema.Struct({
    ok: BooleanSchema,
    verifiedAt: NN,
    verifiedBy: NS,
    url: StringSchema,
    freshness: Freshness,
  }),
  apiListStaleWikiPages: array(
    Schema.Struct({
      ...WikiIdentityFields,
      status: NS,
      verified_at: NN,
      verified_by: NS,
      verify_interval: NN,
      updated_at: NumberSchema,
      url: StringSchema,
      freshness: Freshness,
    }),
  ),
  apiPatchWikiPage: Schema.Struct({ ok: BooleanSchema, url: StringSchema }),
  apiListWikiTemplates: array(Schema.Struct({ ...WikiIdentityFields, type: NS, url: StringSchema })),
  apiDeleteWikiPage: Schema.Struct({ ok: BooleanSchema, deletedCount: NumberSchema, linkedByCount: NumberSchema }),
  apiUndeleteWikiPage: Schema.Struct({
    ok: BooleanSchema,
    id: StringSchema,
    slug: StringSchema,
    url: StringSchema,
    restoredCount: NumberSchema,
  }),
  apiListWikiTrash: array(
    Schema.Struct({ ...WikiIdentityFields, parent_id: NS, deleted_at: NN, purgeAfter: NumberSchema }),
  ),
  apiGetWikiTree: array(WikiTreeNode),
  apiListWikiRevisions: array(Schema.Struct({ ...WikiRevisionFields, author_name: NS })),
  apiGetWikiRevision: Schema.Struct({ ...WikiRevisionFields, content: StringSchema }),
  apiGetWikiRevisionDiff: Schema.Struct({ from: StringSchema, to: StringSchema, diff: StringSchema }),
  apiGetWikiDraft: WikiDraft,
  apiSaveWikiDraft: Schema.Struct({ ok: BooleanSchema, pageId: StringSchema, updatedAt: NumberSchema }),
  apiDiscardWikiDraft: Ok,
  apiWatchWikiPage: Schema.Struct({
    ok: BooleanSchema,
    pageId: StringSchema,
    subtree: BooleanSchema,
    url: StringSchema,
  }),
  apiUnwatchWikiPage: Ok,
  apiListWikiWatches: array(
    Schema.Struct({
      id: StringSchema,
      pageId: StringSchema,
      subtree: BooleanSchema,
      createdAt: NumberSchema,
      slug: StringSchema,
      title: StringSchema,
      url: StringSchema,
    }),
  ),
  apiListWikiNotifications: array(
    Schema.Struct({
      id: StringSchema,
      pageId: NS,
      slug: StringSchema,
      title: StringSchema,
      action: StringSchema,
      actorId: NS,
      summary: NS,
      createdAt: NumberSchema,
      readAt: NN,
      url: StringSchema,
    }),
  ),
  apiMarkWikiNotificationsRead: Ok,
  apiListWikiChanges: Schema.Struct({ changes: array(WikiChange), nextSince: NumberSchema }),
  apiDeleteStoredAttachment: Schema.Void,
  apiCreateToken: Schema.Struct({
    id: StringSchema,
    token: StringSchema,
    name: StringSchema,
    scopes: array(StringSchema),
    expiresAt: NN,
  }),
  apiRevokeToken: Ok,
  apiResolveProjectIdParam: StringSchema,
  apiResolveVisibleProjectIdParam: StringSchema,
  apiListConnectorGrants: array(
    Schema.Struct({
      id: StringSchema,
      client: StringSchema,
      clientId: StringSchema,
      scopes: array(StringSchema),
      grantedAt: NumberSchema,
      expiresAt: NumberSchema,
    }),
  ),
  apiRevokeConnectorGrant: Ok,
  apiListPlaybooks: array(
    Schema.Struct({ name: StringSchema, title: StringSchema, description: StringSchema, whenToUse: StringSchema }),
  ),
  apiGetPlaybook: Schema.Struct({
    name: StringSchema,
    title: StringSchema,
    description: StringSchema,
    whenToUse: StringSchema,
    content: StringSchema,
  }),
  apiGetWorkflow: Schema.Union([
    Schema.Struct({ unchanged: Schema.Literal(true), version: StringSchema }),
    Schema.Struct({ title: StringSchema, description: StringSchema, content: StringSchema, version: StringSchema }),
  ]),
  apiListBrokenWikiLinks: array(
    Schema.Struct({
      linkId: StringSchema,
      sourcePageId: StringSchema,
      sourceSlug: StringSchema,
      sourceTitle: StringSchema,
      targetTitle: StringSchema,
    }),
  ),
  apiBackfillWikiLinks: Schema.Struct({
    processed: NumberSchema,
    nextCursor: Schema.NullOr(Schema.Struct({ updatedAt: NumberSchema, id: StringSchema })),
    pagesProcessed: NumberSchema,
  }),
  apiPurgeExpiredWikiPages: Schema.Struct({
    purgedCount: NumberSchema,
    purgedIds: array(StringSchema),
    moreExpired: BooleanSchema,
  }),
}
