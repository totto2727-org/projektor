import { makeRpcStub } from 'alchemy/Cloudflare/Workers'
import { Effect, Schema } from 'effect'
import { makeCoreClient } from 'projektor/core-client'
import { describe, expect, it, vi } from 'vite-plus/test'

import { resetAuthCachesForTests } from '#services/authentication'

import { ApiResults } from '../../contracts/api-results'
import { makeApiDomainHandlers } from '../../core/api/domain-operations'
import { coreFailure, coreReply } from '../../core/contract'
import type { CoreEnvironment } from '../../core/environment'
import { createTestDatabase } from '../../web/test/database'
import { getIssue } from '../services/issues'
import { apiReply } from '../services/reply'

vi.mock('../../contracts/oauth-provider', () => ({
  oauthApi: () => {
    throw new Error('OAuth provider must not resolve before interactive authorization')
  },
}))

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
  it('runs actual named Core handlers with fresh credential checks and human-only token controls', async () => {
    const database = createTestDatabase()
    try {
      database.sqlite.exec(`
        INSERT INTO users (id,email,name,created_at) VALUES ('facade-user','facade@example.test','Facade',1);
        INSERT INTO workspaces (id,name,slug,created_at) VALUES ('facade-workspace','Workspace','facade',1);
        INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('facade-workspace','facade-user','owner',1);
      `)
      const bearer = 'pk_facade-core'
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer))))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      database.sqlite
        .prepare(`INSERT INTO api_tokens (id,user_id,workspace_id,token_hash,name,scopes,created_at)
        VALUES ('facade-token','facade-user','facade-workspace',?,'Test','["write"]',1)`)
        .run(hash)
      // SQLite and these partial binding substitutes are a local harness, not native Worker acceptance.
      const env = {
        DB: database.db,
        KV: { get: async () => null, put: async () => undefined },
        R2: {},
        ENVIRONMENT: 'production',
        CF_ACCESS_TEAM_DOMAIN: '',
        CF_ACCESS_AUDIENCE: '',
      } as unknown as CoreEnvironment
      const handlers = makeApiDomainHandlers(Effect.succeed(env))
      const actor = { requestUrl: 'https://api.test/api/workspaces/facade', method: 'POST', bearer }
      await expect(
        apiReply(ApiResults.apiCreateToken, handlers.apiCreateToken(actor, 'facade-workspace', { name: 'Forbidden' })),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        apiReply(ApiResults.apiRevokeToken, handlers.apiRevokeToken(actor, 'facade-workspace', 'facade-token')),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        apiReply(ApiResults.apiListConnectorGrants, handlers.apiListConnectorGrants(actor, 'facade-workspace')),
      ).rejects.toMatchObject({ status: 403 })
      await expect(
        apiReply(
          ApiResults.apiRevokeConnectorGrant,
          handlers.apiRevokeConnectorGrant(actor, 'facade-workspace', 'grant'),
        ),
      ).rejects.toMatchObject({ status: 403 })
      expect(database.sqlite.prepare('SELECT count(*) AS count FROM api_tokens').get()).toEqual({ count: 1 })
      const humanHandlers = makeApiDomainHandlers(
        Effect.succeed({ ...env, ENVIRONMENT: 'development' as const, DEV_USER_EMAIL: 'facade@example.test' }),
      )
      const human = { requestUrl: actor.requestUrl, method: 'POST' }
      const created = await apiReply(
        ApiResults.apiCreateToken,
        humanHandlers.apiCreateToken(human, 'facade-workspace', { name: 'Human credential', scopes: ['read'] }),
      )
      expect(created).toMatchObject({ name: 'Human credential', scopes: ['read'], expiresAt: null })
      expect(created.token).toMatch(/^pk_[a-f0-9]{64}$/)
      await expect(
        apiReply(ApiResults.apiRevokeToken, humanHandlers.apiRevokeToken(human, 'facade-workspace', created.id)),
      ).resolves.toEqual({ ok: true })
      expect(database.sqlite.prepare('SELECT count(*) AS count FROM api_tokens').get()).toEqual({ count: 1 })
      const playbooks = await apiReply(
        ApiResults.apiListPlaybooks,
        handlers.apiListPlaybooks(actor, 'facade-workspace'),
      )
      expect(playbooks.length).toBeGreaterThan(0)
      const workflow = await apiReply(ApiResults.apiGetWorkflow, handlers.apiGetWorkflow(actor, 'facade-workspace', {}))
      expect(workflow).toHaveProperty('version')
      await expect(
        apiReply(ApiResults.apiListPlaybooks, handlers.apiListPlaybooks(actor, 'another-workspace')),
      ).rejects.toMatchObject({ status: 403 })
      database.sqlite.exec("UPDATE api_tokens SET scopes = '[]' WHERE id = 'facade-token'")
      await expect(
        apiReply(ApiResults.apiListPlaybooks, handlers.apiListPlaybooks(actor, 'facade-workspace')),
      ).rejects.toMatchObject({ status: 403 })
      database.sqlite.exec(
        "UPDATE api_tokens SET scopes = '[\"write\"]' WHERE id = 'facade-token'; DELETE FROM workspace_members WHERE workspace_id = 'facade-workspace'",
      )
      await expect(
        apiReply(ApiResults.apiListPlaybooks, handlers.apiListPlaybooks(actor, 'facade-workspace')),
      ).rejects.toMatchObject({ status: 403 })
    } finally {
      database.close()
      resetAuthCachesForTests()
    }
  })
  it('preserves maintenance cursor compatibility and conditional workflow variants', () => {
    const backfill = { processed: 2, pagesProcessed: 2, nextCursor: { updatedAt: 9, id: 'page' } }
    expect(Schema.decodeUnknownSync(ApiResults.apiBackfillWikiLinks)(backfill)).toEqual(backfill)
    const unchanged = { unchanged: true, version: 'current' }
    expect(Schema.decodeUnknownSync(ApiResults.apiGetWorkflow)(unchanged)).toEqual(unchanged)
    const full = { title: 'Workflow', description: 'Rules', content: 'Do work', version: 'current' }
    expect(Schema.decodeUnknownSync(ApiResults.apiGetWorkflow)(full)).toEqual(full)
    expect(() => Schema.decodeUnknownSync(ApiResults.apiGetWorkflow)({ version: 'current' })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ApiResults.apiBackfillWikiLinks)({ ...backfill, nextCursor: { id: 'page' } }),
    ).toThrow()
  })
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
