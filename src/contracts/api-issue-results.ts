import { Schema } from 'effect'

import { BooleanSchema, Id, Keyed, NN, NS, NumberSchema, Ok, StringSchema, array } from './api-result-codecs.ts'
import { Brand, TaskStatus, TaskType } from './api-workspace-results.ts'
import { extendStructInOrder, fieldsInOrder, structInOrder } from './ordered-schema.ts'

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

const BatchIssue = Schema.Struct({
  ...IssueFields,
  body: Schema.optional(StringSchema),
  customFields: array(FieldValue),
  url: StringSchema,
})

export const sprintResults = [
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
] as const

export const issueResults = [
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
] as const
