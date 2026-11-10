import { makeRpcStub } from 'alchemy/Cloudflare/Workers'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { ApiResults } from '../../contracts/api-results'
import { makeCoreClient } from '../../core/client'
import { coreFailure, coreReply } from '../../core/contract'
import { getIssue } from '../services/issues'
import { apiReply } from '../services/reply'

const PublicIssue = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  links: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
})

// These substitute bindings test adapter execution, not workerd/native binding acceptance.
function clientFor(wire: () => Promise<string>) {
  return makeRpcStub<{ load(): Effect.Effect<string> }>({ load: wire })
}

const issue = { id: 'issue', title: 'Public issue', links: [{ id: 'linked', title: 'Linked issue' }] }

describe('API facade reply boundary', () => {
  it('dispatches a concrete issue operation with the current actor and workspace only', async () => {
    const actor = { requestUrl: 'https://example.test/api/workspaces/team/issues/issue', method: 'GET' }
    const publicIssue = {
      id: 'issue',
      workspace_id: 'workspace',
      project_id: 'project',
      number: 1,
      title: 'Title',
      body: 'Body',
      status: 'todo',
      priority: 'high',
      assignee_id: null,
      labels: '["public"]',
      parent_id: null,
      type_id: null,
      status_id: null,
      status_category: null,
      sprint_id: null,
      created_by_id: 'user',
      author_kind: null,
      created_at: 1,
      updated_at: 2,
      completed_at: null,
      needs_audit: false,
      project_key: 'PROJ',
      project_name: 'Project',
      type_key: null,
      type_name: null,
      status_key: null,
      status_name: null,
      rollup: { total: 1, byStatus: { todo: 1 }, done: 0, remaining: 1 },
      links: [
        {
          id: 'link',
          type: 'blocks',
          linkedIssueId: 'linked',
          linkedIssueTitle: 'Linked',
          linkedIssueNumber: 2,
          linkedIssueProjectKey: 'PROJ',
          linkedIssueStatusCategory: 'todo',
          createdById: 'user',
          createdAt: 1,
        },
      ],
      customFields: [{ key: 'scope', label: 'Scope', type: 'text', value: 'Public' }],
      url: '/workspaces/team/issues/PROJ-1',
    }
    const core = makeCoreClient({
      apiGetIssue: async (actualActor: unknown, workspaceId: unknown, input: unknown) => {
        expect({ actor: actualActor, workspaceId, input }).toEqual({
          actor,
          workspaceId: 'workspace',
          input: { id: 'issue' },
        })
        return Effect.runPromise(coreReply('getIssue', ApiResults.apiGetIssue, Effect.succeed(publicIssue)))
      },
    })
    await expect(
      getIssue({ core, actor, workspaceId: 'workspace', userId: 'presentation-user' }, { id: 'issue' }),
    ).resolves.toEqual(publicIssue)
  })

  it('preserves custom-field casing, options and internal metadata', async () => {
    const fields = [
      {
        id: 'field',
        workspaceId: 'workspace',
        projectId: null,
        key: 'size',
        label: 'Size',
        type: 'select',
        options: ['small', 'large'],
        createdAt: 1,
        isInternal: true,
      },
    ]
    const wire = coreReply('fields', ApiResults.apiListCustomFieldDefs, Effect.succeed(fields))
    await expect(apiReply(ApiResults.apiListCustomFieldDefs, wire)).resolves.toEqual(fields)
  })

  it('preserves displaced and reclaimed claim snapshots rather than just their paths', async () => {
    const snapshot = {
      id: 'claim',
      workspaceId: 'workspace',
      issueId: 'issue',
      agentId: null,
      path: 'src/file.ts',
      claimedAt: 1,
      releasedAt: 2,
      releaseReason: 'overridden',
      live: true,
    }
    const result = {
      created: [],
      overridden: [snapshot],
      reclaimed: [{ ...snapshot, releaseReason: 'expired', live: false }],
    }
    await expect(
      apiReply(ApiResults.apiClaimFiles, coreReply('claimFiles', ApiResults.apiClaimFiles, Effect.succeed(result))),
    ).resolves.toEqual(result)
  })

  it('retains membership creation timestamps in the workspace catalog', async () => {
    const workspaces = [{ id: 'workspace', name: 'Workspace', slug: 'team', role: 'member', createdAt: 1 }]
    await expect(
      apiReply(
        ApiResults.apiListWorkspaces,
        coreReply('listWorkspaces', ApiResults.apiListWorkspaces, Effect.succeed(workspaces)),
      ),
    ).resolves.toEqual(workspaces)
  })

  it('round trips a command that deliberately returns no data', async () => {
    await expect(
      apiReply(
        ApiResults.apiRevokeShareToken,
        coreReply('revokeShareToken', ApiResults.apiRevokeShareToken, Effect.void),
      ),
    ).resolves.toBeUndefined()
  })

  it('preserves the complete recursive Wiki tree', async () => {
    const tree = [
      {
        id: 'root',
        slug: 'root',
        title: 'Root',
        url: '/wiki/root',
        type: null,
        children: [{ id: 'child', slug: 'child', title: 'Child', url: '/wiki/child', type: 'guide', children: [] }],
      },
    ]
    await expect(
      apiReply(ApiResults.apiGetWikiTree, coreReply('tree', ApiResults.apiGetWikiTree, Effect.succeed(tree))),
    ).resolves.toEqual(tree)
  })

  it('validates nested Wiki children instead of trusting the outer array', async () => {
    const wire = JSON.stringify({
      _tag: 'Success',
      success: [
        {
          id: 'root',
          slug: 'root',
          title: 'Root',
          url: '/wiki/root',
          type: null,
          children: [{ privateDiagnostic: 'not a page' }],
        },
      ],
    })
    await expect(apiReply(ApiResults.apiGetWikiTree, Effect.succeed(wire))).rejects.toMatchObject({
      _tag: 'CorePublicError',
      status: 502,
      message: 'The Core service returned an invalid response.',
    })
  })

  it('does not turn cancellation into an application or transport error', async () => {
    await expect(apiReply(PublicIssue, Effect.interrupt)).rejects.not.toMatchObject({ _tag: 'CorePublicError' })
  })

  it('preserves the declared public success fields', async () => {
    const client = clientFor(() => Effect.runPromise(coreReply('load', PublicIssue, Effect.succeed(issue))))
    await expect(apiReply(PublicIssue, client.load())).resolves.toEqual(issue)
  })

  it('rejects a success value that violates the operation output codec', async () => {
    const client = clientFor(async () =>
      JSON.stringify({ _tag: 'Success', success: { ...issue, links: 'private SQL' } }),
    )
    await expect(apiReply(PublicIssue, client.load())).rejects.toMatchObject({
      _tag: 'CorePublicError',
      status: 502,
      message: 'The Core service returned an invalid response.',
    })
  })

  it('preserves selected public conflict details without reviving an original error', async () => {
    const failure = coreFailure(409, 'Revision changed', {
      kind: 'conflict',
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      retryAfter: 4,
    })
    const client = clientFor(() => Effect.runPromise(coreReply('update', PublicIssue, Effect.fail(failure))))
    await expect(apiReply(PublicIssue, client.load())).rejects.toMatchObject({
      _tag: 'CorePublicError',
      status: 409,
      kind: 'conflict',
      message: 'Revision changed',
      details: { currentRevisionId: 'revision', diff: 'public diff' },
      retryAfter: 4,
      occurrenceId: failure.occurrenceId,
    })
    await expect(apiReply(PublicIssue, client.load())).rejects.not.toHaveProperty('originalError')
  })

  it('sanitizes a transport failure instead of exposing native diagnostics', async () => {
    const client = clientFor(async () => {
      throw new Error('private storage diagnostic')
    })
    await expect(apiReply(PublicIssue, client.load())).rejects.toMatchObject({
      _tag: 'CorePublicError',
      status: 502,
      message: 'The Core service is temporarily unavailable.',
    })
    await expect(apiReply(PublicIssue, client.load())).rejects.not.toHaveProperty('originalError')
  })

  it('keeps concurrent contexts bound to their respective services', async () => {
    const first = clientFor(() =>
      Effect.runPromise(coreReply('load', PublicIssue, Effect.succeed({ ...issue, id: 'first' }))),
    )
    const second = clientFor(() =>
      Effect.runPromise(coreReply('load', PublicIssue, Effect.succeed({ ...issue, id: 'second' }))),
    )
    await expect(
      Promise.all([apiReply(PublicIssue, first.load()), apiReply(PublicIssue, second.load())]),
    ).resolves.toEqual([
      { ...issue, id: 'first' },
      { ...issue, id: 'second' },
    ])
  })
})
