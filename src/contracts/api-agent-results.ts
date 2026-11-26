import { Schema } from 'effect'

import { ApiPrincipal, ApiUserBootstrap, ApiWorkspace } from './api-auth.ts'
import { BooleanSchema, Id, NN, NS, Named, NumberSchema, Ok, StringSchema, array } from './api-result-codecs.ts'
import { fieldsInOrder } from './ordered-fields.ts'
import { extendStructInOrder, structInOrder } from './ordered-schema.ts'
import { ReviewStatusSchema } from './review-targets.ts'

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

export const agentResults = [
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
] as const
