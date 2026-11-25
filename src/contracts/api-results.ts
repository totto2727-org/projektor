import { Schema } from 'effect'

import { agentResults } from './api-agent-results.ts'
import { issueResults, sprintResults } from './api-issue-results.ts'
import { BooleanSchema, NN, NumberSchema, Ok, StringSchema, array } from './api-result-codecs.ts'
import { wikiResults } from './api-wiki-results.ts'
import { workspaceResults } from './api-workspace-results.ts'
import { fieldsInOrder, structInOrder } from './ordered-schema.ts'

const additionalResults = [
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
] as const

const wikiMaintenanceResults = [
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
export const ApiResults = fieldsInOrder([
  ...agentResults,
  ...sprintResults,
  ...workspaceResults,
  ...issueResults,
  ...wikiResults,
  ...additionalResults,
  ...wikiMaintenanceResults,
])
