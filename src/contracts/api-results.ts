import { Schema } from 'effect'

import { ApiPrincipal, ApiUserBootstrap, ApiWorkspace } from './api-auth'

const array = <Item extends Schema.Top>(item: Item) => Schema.mutable(Schema.Array(item))

const S = Schema.String
const N = Schema.Number
const B = Schema.Boolean
const NS = Schema.NullOr(S)
const NN = Schema.NullOr(N)
const Id = Schema.Struct({ id: S })
const Ok = Schema.Struct({ ok: B })
const Named = Schema.Struct({ id: S, name: S })
const Keyed = Schema.Struct({ id: S, key: S, name: S })
const CreatedIssue = Schema.Struct({ id: S, number: Schema.optional(N) })

const SessionFields = {
  id: S,
  workspaceId: S,
  issueId: NS,
  tokenId: NS,
  name: S,
  status: Schema.Literals(['active', 'ended']),
  startedAt: N,
  lastHeartbeatAt: N,
  endedAt: NN,
}
const Session = Schema.Struct(SessionFields)
const Lease = Schema.Struct({
  id: S,
  workspaceId: S,
  issueId: S,
  agentSessionId: S,
  claimedAt: N,
  releasedAt: NN,
  releaseReason: NS,
})
const ClaimFields = { id: S, workspaceId: S, issueId: S, agentId: NS, path: S, claimedAt: N, releasedAt: NN }
const Claim = Schema.Struct(ClaimFields)
const Message = Schema.Struct({ id: S, workspaceId: S, scope: S, agentId: NS, body: S, createdAt: N })
const ReleasedClaim = Schema.Struct({ ...ClaimFields, releaseReason: NS })
const ActiveClaim = Schema.Struct({ ...ClaimFields, releaseReason: NS, live: B })
const Claims = Schema.Struct({
  created: array(Claim),
  overridden: array(ActiveClaim),
  reclaimed: array(ActiveClaim),
})
const Comment = Schema.Struct({
  id: S,
  body: S,
  created_at: N,
  updated_at: N,
  author_id: S,
  author_name: S,
  author_email: S,
})
const Attachment = Schema.Struct({
  id: S,
  kind: Schema.Literals(['file', 'wiki_ref', 'url']),
  filename: S,
  contentType: S,
  size: N,
  url: NS,
  createdAt: N,
  wikiPage: Schema.NullOr(Schema.Struct({ id: S, title: NS, url: S })),
})
const CustomField = Schema.Struct({
  id: S,
  workspaceId: S,
  projectId: NS,
  key: S,
  label: S,
  type: Schema.Literals(['text', 'number', 'select', 'date', 'user']),
  options: Schema.NullOr(array(S)),
  createdAt: N,
  isInternal: B,
})
const GroupFields = { id: S, name: S, description: NS, createdAt: N }
const Group = Schema.Struct({ ...GroupFields, memberCount: N, grantCount: N })
const GroupDetail = Schema.Struct({
  ...GroupFields,
  workspaceId: S,
  members: array(Schema.Struct({ userId: S, email: S, name: S, addedAt: N, addedBy: S })),
  grants: array(
    Schema.Struct({
      projectId: S,
      projectName: S,
      projectKey: S,
      role: Schema.Literals(['viewer', 'member', 'admin']),
    }),
  ),
})
const Sprint = Schema.Struct({
  id: S,
  workspaceId: S,
  projectId: S,
  name: S,
  goal: NS,
  status: Schema.Literals(['planned', 'active', 'completed']),
  startDate: NN,
  endDate: NN,
  createdAt: N,
  updatedAt: N,
})
const Feedback = Schema.Struct({
  id: S,
  sourceId: S,
  sourceName: NS,
  rating: NN,
  ratingScale: NS,
  body: NS,
  submitterLabel: NS,
  sourceUrl: NS,
  appVersion: NS,
  status: S,
  linkedIssueId: NS,
  createdAt: N,
})
const FeedbackSourceFields = {
  id: S,
  name: S,
  description: NS,
  isActive: B,
  allowedOrigins: Schema.NullOr(array(S)),
  tokenPreview: S,
  createdAt: N,
  revokedAt: NN,
}
const FeedbackSource = Schema.Struct(FeedbackSourceFields)
const FeedbackSummary = array(
  Schema.Struct({
    sourceId: S,
    sourceName: NS,
    totalCount: N,
    versions: array(
      Schema.Struct({
        appVersion: NS,
        totalCount: N,
        withCommentCount: N,
        thumbsUpPct: NN,
        avgFiveStar: NN,
        lastSeenAt: N,
      }),
    ),
  }),
)
const Activity = Schema.Struct({
  type: S,
  actor: NS,
  entity_type: S,
  entity_id: S,
  entity_ref: S,
  summary: S,
  created_at: N,
})
const Brand = Schema.Struct({ displayName: NS, accent: NS, onAccent: NS, fontFamily: NS, fontUrl: NS, logoUrl: NS })
const Distribution = Schema.Struct({ count: N, avg: NN, p50: NN, p90: NN })
const HeatmapEntryFields = { path: S, segment: S, isLeaf: B }
const Heatmap = Schema.Union([
  Schema.Struct({
    prefix: S,
    mode: Schema.Literal('claims'),
    totalDistinctIssues: N,
    entries: array(Schema.Struct({ ...HeatmapEntryFields, distinctIssueCount: N, claimCount: N })),
  }),
  Schema.Struct({
    prefix: S,
    mode: Schema.Literal('contention'),
    totalDistinctIssues: N,
    entries: array(Schema.Struct({ ...HeatmapEntryFields, distinctRejectedIssueCount: N, conflictCount: N })),
  }),
])
const Project = Schema.Struct({
  id: S,
  workspaceId: S,
  name: S,
  key: S,
  description: NS,
  createdAt: N,
  updatedAt: N,
  agentWipLimit: NN,
  slug: NS,
  archivedAt: NN,
})
const ProjectSummary = Schema.Struct({
  id: S,
  name: S,
  key: S,
  slug: NS,
  description: NS,
  workspace_id: S,
  workspace_name: S,
  workspace_slug: S,
  open_issue_count: N,
  backlog_issue_count: N,
  archived_at: NN,
  created_at: N,
  updated_at: N,
})
const TaskType = Schema.Struct({
  id: S,
  workspace_id: S,
  key: S,
  name: S,
  color: NS,
  icon: NS,
  position: N,
  is_default: N,
})
const TaskStatus = Schema.Struct({
  id: S,
  workspace_id: S,
  key: S,
  name: S,
  color: NS,
  position: N,
  is_default: N,
  is_review_step: N,
  category: Schema.Literals(['todo', 'in_progress', 'done', 'cancelled']),
})
const IssueLink = Schema.Struct({
  id: S,
  type: Schema.Literals(['blocks', 'blocked_by', 'relates_to', 'duplicates']),
  linkedIssueId: S,
  linkedIssueTitle: S,
  linkedIssueNumber: N,
  linkedIssueProjectKey: S,
  linkedIssueStatusCategory: S,
  createdById: S,
  createdAt: N,
})
const Rollup = Schema.Struct({ total: N, byStatus: Schema.Record(S, N), done: N, remaining: N })
const FieldValue = Schema.Struct({ key: S, label: S, type: S, value: S })
const IssueFields = {
  id: S,
  workspace_id: S,
  project_id: S,
  number: N,
  title: S,
  status: S,
  priority: S,
  assignee_id: NS,
  labels: S,
  parent_id: NS,
  type_id: NS,
  status_id: NS,
  status_category: NS,
  sprint_id: NS,
  created_by_id: S,
  author_kind: NS,
  created_at: N,
  updated_at: N,
  completed_at: NN,
  needs_audit: B,
  project_key: NS,
  project_name: NS,
  type_key: NS,
  type_name: NS,
  status_key: NS,
  status_name: NS,
}
const IssueListItem = Schema.Struct({
  ...IssueFields,
  body: Schema.optional(S),
  assignee_name: NS,
  customFields: array(FieldValue),
  rollup: Schema.optional(Rollup),
  url: S,
})
const IssueDetail = Schema.Struct({
  ...IssueFields,
  body: S,
  rollup: Rollup,
  links: array(IssueLink),
  customFields: array(FieldValue),
  url: S,
})
const PrioritizedIssue = Schema.Struct({
  id: S,
  title: S,
  status: S,
  priority: S,
  project_id: S,
  number: N,
  status_id: NS,
  status_category: NS,
  _score: N,
  _score_breakdown: Schema.Struct({ centrality: N, priority: N, story_points: N }),
  needsGrooming: Schema.optional(Schema.Literal(true)),
  missingCriteria: Schema.optional(array(S)),
})
const FlowMetrics = Schema.Struct({
  leadTime: Distribution,
  leadTimeExcluded: N,
  cycleTime: Distribution,
  wipOverTime: array(Schema.Struct({ date: S, count: N })),
  throughputOverTime: array(Schema.Struct({ bucketStart: S, count: N })),
  bugShareOverTime: array(Schema.Struct({ bucketStart: S, total: N, bugCount: N, bugSharePercent: NN })),
  bugTypeTracked: B,
  reviewLatency: Distribution,
  reviewLatencyOverTime: array(Schema.Struct({ bucketStart: S, p50: NN })),
  humanInterventions: Distribution,
  autonomyRatio: Distribution,
  cfdOverTime: array(Schema.Struct({ bucketStart: S, backlogTodo: N, inProgress: N, inReview: N, done: N })),
  timeInProgress: Distribution,
  arrivalVsCompletionOverTime: array(Schema.Struct({ bucketStart: S, created: N, completed: N, net: N })),
  flowEfficiency: Distribution,
  agingWip: array(Schema.Struct({ id: S, status: Schema.Literals(['in_progress', 'in_review']), ageSeconds: N })),
  factoryHealth: Schema.Struct({ leaseExpiries: N, abandonedClaims: N, gateRejections: N, wipCapPressure: N }),
})
const Freshness = Schema.NullOr(
  Schema.Struct({ state: Schema.Literals(['fresh', 'stale', 'unverified']), staleSince: NN }),
)
const WikiMetadataFields = {
  type: NS,
  tags: array(S),
  status: NS,
  verified_at: NN,
  verified_by: NS,
  owners: array(S),
  verify_interval: NN,
  is_template: B,
}
const WikiIdentityFields = { id: S, slug: S, title: S, project_id: NS }
const WikiSummaryFields = { ...WikiIdentityFields, parent_id: NS, updated_at: N, ...WikiMetadataFields }
const WikiSummary = Schema.Struct({ ...WikiSummaryFields, url: S })
const WikiPage = Schema.Struct({
  ...WikiSummaryFields,
  content: S,
  version: Schema.optional(N),
  revisionId: NS,
  url: S,
  freshness: Freshness,
})
const WikiRevisionFields = { id: S, title: S, summary: NS, author_id: S, created_at: N }
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
    id: S,
    slug: S,
    title: S,
    url: S,
    type: NS,
    children: array(WikiTreeNode),
  }),
)
const WikiDraft = Schema.NullOr(Schema.Struct({ title: S, content: S, baseRevisionId: NS, updatedAt: N }))
const WikiChange = Schema.Struct({
  id: S,
  action: Schema.Literals(['created', 'updated', 'deleted']),
  pageId: S,
  slug: NS,
  title: NS,
  projectId: NS,
  actorId: NS,
  createdAt: N,
  deletedPageIds: Schema.NullOr(array(S)),
  deletedPageIdsTruncated: B,
})

/** Closed operation-specific public outputs. These codecs import no domain or storage implementation. */
export const ApiResults = {
  apiAuthenticate: ApiPrincipal,
  apiResolveWorkspace: ApiWorkspace,
  apiListWorkspaces: array(Schema.Struct({ id: S, name: S, slug: S, role: S, createdAt: N })),
  apiUserBootstrap: ApiUserBootstrap,
  apiCreateWorkspace: Schema.Struct({ id: S, name: S, slug: S }),
  apiCreateUserToken: Schema.Struct({ token: S }),
  apiDeleteUserToken: Ok,
  apiRegisterAgent: Session,
  apiStartWork: Schema.Struct({ sessionId: S, lease: Lease, claimedFiles: array(Claim) }),
  apiHeartbeatAgent: Session,
  apiEndAgent: Session,
  apiFinishWork: Session,
  apiListActiveAgents: Schema.Struct({
    items: array(Schema.Struct({ ...SessionFields, issueRef: NS, live: B })),
  }),
  apiPostMessage: Message,
  apiListMessages: Schema.Struct({ items: array(Message), nextCursor: NS }),
  apiClaimFiles: Claims,
  apiReleaseFiles: Schema.Struct({ released: array(ReleasedClaim), count: N }),
  apiListFileClaims: Schema.Struct({
    items: array(Schema.Struct({ ...ClaimFields, releaseReason: NS, issueRef: S, live: B })),
  }),
  apiClaimIssue: Lease,
  apiReleaseIssue: Ok,
  apiListIssueLeases: Schema.Struct({
    items: array(
      Schema.Struct({
        id: S,
        issueId: S,
        issueRef: S,
        agentSessionId: S,
        agentName: S,
        claimedAt: N,
        live: B,
      }),
    ),
  }),
  apiListComments: array(Comment),
  apiAddComment: Id,
  apiUpdateComment: Ok,
  apiDeleteComment: Ok,
  apiListAttachments: array(Attachment),
  apiCreateLinkAttachment: Id,
  apiGetAttachment: Attachment,
  apiDeleteAttachment: Schema.Struct({ r2Key: S }),
  apiListCustomFieldDefs: array(CustomField),
  apiCreateCustomFieldDef: Schema.Struct({ id: S, key: S, label: S, type: S }),
  apiUpdateCustomFieldDef: Ok,
  apiDeleteCustomFieldDef: Ok,
  apiListGroups: array(Group),
  apiGetGroup: GroupDetail,
  apiListMemberGroups: array(Schema.Struct({ userId: S, groups: array(Named) })),
  apiCreateGroup: Schema.Struct({ id: S, name: S, description: NS }),
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
  apiMoveIssuesToSprint: Schema.Union([array(Schema.Never), Schema.Struct({ ok: B, count: N })]),
  apiListFeedback: array(Feedback),
  apiUpdateFeedbackStatus: Ok,
  apiConvertFeedbackToIssue: CreatedIssue,
  apiBulkMarkReviewed: Schema.Struct({ updated: N }),
  apiBulkConvertToIssue: Schema.Struct({ id: S, number: Schema.optional(N), convertedCount: N }),
  apiGetFeedbackSummary: FeedbackSummary,
  apiCreateFeedbackSource: Schema.Struct({ id: S, token: S }),
  apiListFeedbackSources: array(FeedbackSource),
  apiGetFeedbackSource: Schema.Struct({ ...FeedbackSourceFields, projectId: S }),
  apiUpdateFeedbackSource: Ok,
  apiRotateFeedbackSourceToken: Schema.Struct({ token: S }),
  apiRevokeFeedbackSource: Ok,
  apiGetCodeHeatmap: Heatmap,
  apiGetFlowMetrics: FlowMetrics,
  apiListProjectActivity: array(Activity),
  apiComposePlaybook: Schema.Struct({ name: S, variant: S, directive: S }),
  apiListProjects: array(ProjectSummary),
  apiListProjectsInWorkspace: array(Project),
  apiGetProject: Project,
  apiGetProjectBySlug: Project,
  apiCreateProject: Schema.Struct({ id: S, name: S, key: S, slug: S }),
  apiUpdateProject: Ok,
  apiDeleteProject: Ok,
  apiCreateLink: Id,
  apiDeleteLink: Ok,
  apiListLinksForIssue: array(IssueLink),
  apiListIssues: Schema.Struct({ items: array(IssueListItem), total: NN, nextCursor: NS }),
  apiResolveIssueIdParam: S,
  apiGetIssue: IssueDetail,
  apiGetIssuesBatch: Schema.Struct({
    items: array(Schema.Struct({ ...IssueFields, body: Schema.optional(S), customFields: array(FieldValue), url: S })),
    missing: array(S),
  }),
  apiCreateIssue: Schema.Struct({ id: S, number: N }),
  apiUpdateIssue: Ok,
  apiDeleteIssue: Ok,
  apiGetPrioritizedIssues: Schema.Struct({
    issues: array(PrioritizedIssue),
    droppedNotReady: Schema.optional(N),
    degraded: Schema.optional(B),
  }),
  apiSearchIssues: array(
    Schema.Struct({
      id: S,
      number: N,
      title: S,
      status: S,
      priority: S,
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
  apiCreateShareToken: Schema.Struct({ token: S, url: S }),
  apiRevokeShareToken: Schema.Void,
  apiUpdateWorkspace: Ok,
  apiGetWorkspaceWithMembers: Schema.Struct({
    id: S,
    name: S,
    slug: S,
    currentUserRole: Schema.optional(S),
    members: array(Schema.Struct({ id: S, name: S, email: S, avatarUrl: NS, role: S, joinedAt: N })),
  }),
  apiListTokens: array(
    Schema.Struct({ id: S, name: S, scopes: array(S), lastUsedAt: NN, expiresAt: NN, createdAt: N }),
  ),
  apiInviteMember: Ok,
  apiRemoveMember: Ok,
  apiUpdateMemberRole: Ok,
  apiDeleteWorkspace: Ok,
  apiGetWorkspaceMcpInfo: Schema.Struct({ mcpUrl: S, workspaceId: S, workspaceSlug: S, mcpAddCommandTemplate: S }),
  apiGetWorkspaceBrand: Brand,
  apiUpdateWorkspaceBrand: Brand,
  apiDeleteWorkspaceLogo: Ok,
  apiListWikiPages: array(WikiSummary),
  apiSearchWiki: array(
    Schema.Struct({
      ...WikiIdentityFields,
      type: NS,
      tags: array(S),
      status: NS,
      verified_at: NN,
      verified_by: NS,
      owners: array(S),
      verify_interval: NN,
      excerpt: S,
      rank: N,
      freshness: Freshness,
    }),
  ),
  apiGetWikiPage: WikiPage,
  apiGetWikiBacklinks: array(Schema.Struct({ linkId: S, pageId: S, slug: S, title: S, url: S, snippet: NS })),
  apiCreateWikiPage: Schema.Struct({
    id: S,
    slug: S,
    projectId: NS,
    url: S,
    type: NS,
    tags: array(S),
    status: NS,
    verifiedAt: NN,
    verifiedBy: NS,
    owners: array(S),
    verifyInterval: NN,
    isTemplate: B,
  }),
  apiUpdateWikiPage: Schema.Struct({ ok: B, url: S }),
  apiVerifyWikiPage: Schema.Struct({ ok: B, verifiedAt: NN, verifiedBy: NS, url: S, freshness: Freshness }),
  apiListStaleWikiPages: array(
    Schema.Struct({
      ...WikiIdentityFields,
      status: NS,
      verified_at: NN,
      verified_by: NS,
      verify_interval: NN,
      updated_at: N,
      url: S,
      freshness: Freshness,
    }),
  ),
  apiPatchWikiPage: Schema.Struct({ ok: B, url: S }),
  apiListWikiTemplates: array(Schema.Struct({ ...WikiIdentityFields, type: NS, url: S })),
  apiDeleteWikiPage: Schema.Struct({ ok: B, deletedCount: N, linkedByCount: N }),
  apiUndeleteWikiPage: Schema.Struct({ ok: B, id: S, slug: S, url: S, restoredCount: N }),
  apiListWikiTrash: array(Schema.Struct({ ...WikiIdentityFields, parent_id: NS, deleted_at: NN, purgeAfter: N })),
  apiGetWikiTree: array(WikiTreeNode),
  apiListWikiRevisions: array(Schema.Struct({ ...WikiRevisionFields, author_name: NS })),
  apiGetWikiRevision: Schema.Struct({ ...WikiRevisionFields, content: S }),
  apiGetWikiRevisionDiff: Schema.Struct({ from: S, to: S, diff: S }),
  apiGetWikiDraft: WikiDraft,
  apiSaveWikiDraft: Schema.Struct({ ok: B, pageId: S, updatedAt: N }),
  apiDiscardWikiDraft: Ok,
  apiWatchWikiPage: Schema.Struct({ ok: B, pageId: S, subtree: B, url: S }),
  apiUnwatchWikiPage: Ok,
  apiListWikiWatches: array(Schema.Struct({ id: S, pageId: S, subtree: B, createdAt: N, slug: S, title: S, url: S })),
  apiListWikiNotifications: array(
    Schema.Struct({
      id: S,
      pageId: NS,
      slug: S,
      title: S,
      action: S,
      actorId: NS,
      summary: NS,
      createdAt: N,
      readAt: NN,
      url: S,
    }),
  ),
  apiMarkWikiNotificationsRead: Ok,
  apiListWikiChanges: Schema.Struct({ changes: array(WikiChange), nextSince: N }),
}
