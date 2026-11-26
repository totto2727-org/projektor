import { Iterable } from 'effect'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { assertAgentSessionAccess } from '#commands/agent-identity.ts'
import { postMessage } from '#commands/agent-messages.ts'
import { endAgent, finishWork, heartbeatAgent, registerAgent } from '#commands/agents.ts'
import { claimFiles, releaseFiles } from '#commands/file-claims.ts'
import { claimIssue, releaseIssue } from '#commands/issue-leases.ts'
import { updateIssue } from '#commands/issues.ts'
import type { ServiceCtx } from '#commands/types.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'
import { runInOrder } from '#tests/run-effect.ts'
import { createTestDatabase } from '@/test/database.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []

const fixture = function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  const issueId = crypto.randomUUID()
  database.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1);
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w','Workspace','workspace',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','member',1);
    INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES ('p','w','Project','PROJ',1,1);
    INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g','w','Group',1);
    INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g','u','u',1);
    INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g','p','member');
  `)
  database.sqlite
    .prepare(`INSERT INTO issues
    (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at)
    VALUES (?,'w','p',1,'Original','backlog','medium','u',1,1)`)
    .run(issueId)
  const ctx: ServiceCtx = {
    db: database.db,
    kv: {
      get: vi.fn<() => Promise<null>>(async () => null),
      put: vi.fn<KVNamespace['put']>(),
      delete: vi.fn<KVNamespace['delete']>(),
    } as unknown as KVNamespace,
    r2: {} as R2Bucket,
    workspaceId: 'w',
    userId: 'u',
    role: 'member',
    auth: { kind: 'agent', method: 'oauth', credentialId: 'grant-a' },
  }
  return { ...database, ctx, issueId }
}

describe('agent session ownership at shared command boundaries', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test('denies foreign admin act-as but permits explicit administrative cleanup', async () => {
    expect.hasAssertions()
    const testFixture = fixture()
    const session = await registerAgent(testFixture.ctx, { issueId: testFixture.issueId, name: 'holder' })
    await claimIssue(testFixture.ctx, { agentId: session.id, issueId: testFixture.issueId })
    await claimFiles(testFixture.ctx, { agentId: session.id, issueId: testFixture.issueId, paths: ['src/admin.ts'] })
    const admin: ServiceCtx = {
      ...testFixture.ctx,
      role: 'admin',
      auth: { kind: 'agent', method: 'oauth', credentialId: 'foreign-admin' },
    }
    const actions = [
      () => heartbeatAgent(admin, { allowAdministrativeOverride: true, id: session.id }),
      () => postMessage(admin, { agentId: session.id, body: 'spoofed', scope: 'workspace' }),
      () => claimIssue(admin, { agentId: session.id, issueId: testFixture.issueId }),
      () =>
        claimFiles(admin, {
          agentId: session.id,
          force: true,
          issueId: testFixture.issueId,
          paths: ['src/foreign.ts'],
        }),
      () => updateIssue(admin, testFixture.issueId, { agentSessionId: session.id, title: 'Spoofed' }),
      () => finishWork(admin, { issue: testFixture.issueId, sessionId: session.id, status: 'done' }),
    ]
    await runInOrder(actions, async (action): Promise<void> => {
      await expect(action()).rejects.toMatchObject({ kind: 'forbidden' })
    })
    await releaseIssue(admin, { issueId: testFixture.issueId })
    await expect(releaseFiles(admin, { paths: ['src/admin.ts'] })).resolves.toMatchObject({ count: 1 })
    await expect(endAgent(admin, { id: session.id })).resolves.toMatchObject({ status: 'ended' })
    expect(testFixture.sqlite.prepare('SELECT title FROM issues WHERE id = ?').get(testFixture.issueId)).toMatchObject({
      title: 'Original',
    })
  })

  test('uses a legacy token owner only when no newer credential owner exists', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(`INSERT INTO api_tokens (id,workspace_id,user_id,name,token_hash,scopes,created_at)
      VALUES ('token-a','w','u','Token','hash','["*"]',1)`)
    testFixture.ctx.auth = { kind: 'agent', method: 'pat', credentialId: 'token-a' }
    const session = await registerAgent(testFixture.ctx, { name: 'legacy' })
    testFixture.sqlite.prepare('UPDATE agent_sessions SET credential_id = NULL WHERE id = ?').run(session.id)
    await expect(heartbeatAgent(testFixture.ctx, {})).resolves.toMatchObject({ id: session.id })
    testFixture.sqlite
      .prepare("UPDATE agent_sessions SET credential_id = 'different-owner' WHERE id = ?")
      .run(session.id)
    await expect(heartbeatAgent(testFixture.ctx, { id: session.id })).rejects.toMatchObject({ kind: 'forbidden' })
  })

  test('rejects explicit cross-credential impersonation and release omissions before any mutation', async () => {
    expect.hasAssertions()
    const testFixture = fixture()
    const session = await registerAgent(testFixture.ctx, { issueId: testFixture.issueId, name: 'holder' })
    await claimIssue(testFixture.ctx, { agentId: session.id, issueId: testFixture.issueId })
    await claimFiles(testFixture.ctx, { agentId: session.id, issueId: testFixture.issueId, paths: ['src/a.ts'] })
    testFixture.sqlite
      .prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?')
      .run(currentEpochSeconds() - 10, session.id)
    const before = testFixture.sqlite.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(session.id)
    const other: ServiceCtx = { ...testFixture.ctx, auth: { kind: 'agent', method: 'oauth', credentialId: 'grant-b' } }
    const actions = [
      () => heartbeatAgent(other, { id: session.id }),
      () => endAgent(other, { id: session.id }),
      () => claimIssue(other, { agentId: session.id, issueId: testFixture.issueId }),
      () => claimFiles(other, { agentId: session.id, issueId: testFixture.issueId, paths: ['src/b.ts'] }),
      () => postMessage(other, { agentId: session.id, body: 'spoofed', scope: `issue:${testFixture.issueId}` }),
      () => releaseIssue(other, { issueId: testFixture.issueId }),
      () => releaseFiles(other, { paths: ['src/a.ts'] }),
      () => updateIssue(other, testFixture.issueId, { agentSessionId: session.id, title: 'Spoofed' }),
      () =>
        finishWork(other, {
          completionReport: { summary: 'Spoofed', verification: 'Not performed' },
          issue: testFixture.issueId,
          sessionId: session.id,
        }),
    ]
    await runInOrder(actions, async (action): Promise<void> => {
      await expect(action()).rejects.toMatchObject({ kind: 'forbidden' })
    })
    expect(testFixture.sqlite.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(session.id)).toStrictEqual(
      before,
    )
    expect(testFixture.sqlite.prepare('SELECT title FROM issues WHERE id = ?').get(testFixture.issueId)).toMatchObject({
      title: 'Original',
    })
    expect(
      testFixture.sqlite.prepare('SELECT released_at FROM issue_leases WHERE issue_id = ?').get(testFixture.issueId),
    ).toMatchObject({
      released_at: SQL_NULL,
    })
    expect(
      testFixture.sqlite
        .prepare('SELECT released_at FROM issue_file_claims WHERE issue_id = ?')
        .get(testFixture.issueId),
    ).toMatchObject({ released_at: SQL_NULL })
  })

  test('preserves shared-credential fleet operations but applies current project grants', async () => {
    const testFixture = fixture()
    testFixture.ctx.role = 'admin'
    const first = await registerAgent(testFixture.ctx, { issueId: testFixture.issueId, name: 'one' })
    const second = await registerAgent(testFixture.ctx, { issueId: testFixture.issueId, name: 'two' })
    await expect(heartbeatAgent(testFixture.ctx, { id: first.id })).resolves.toMatchObject({ id: first.id })
    await expect(heartbeatAgent(testFixture.ctx, { id: second.id })).resolves.toMatchObject({ id: second.id })
    testFixture.ctx.role = 'member'
    testFixture.sqlite.exec("DELETE FROM group_project_grants WHERE project_id = 'p'")
    await expect(heartbeatAgent(testFixture.ctx, { id: first.id })).rejects.toMatchObject({ kind: 'not_found' })
    await expect(endAgent(testFixture.ctx, { id: second.id })).rejects.toMatchObject({ kind: 'not_found' })
  })

  test('records new human ownership without inferring ownership of legacy null sessions', async () => {
    const testFixture = fixture()
    testFixture.ctx.auth = { kind: 'human', method: 'access' }
    const session = await registerAgent(testFixture.ctx, { name: 'browser' })
    expect(
      testFixture.sqlite.prepare('SELECT credential_id,token_id FROM agent_sessions WHERE id = ?').get(session.id),
    ).toMatchObject({ credential_id: 'user:u', token_id: SQL_NULL })
    await expect(heartbeatAgent(testFixture.ctx, {})).resolves.toMatchObject({ id: session.id })
    testFixture.sqlite.prepare('UPDATE agent_sessions SET credential_id = NULL WHERE id = ?').run(session.id)
    await expect(heartbeatAgent(testFixture.ctx, { id: session.id })).rejects.toMatchObject({ kind: 'forbidden' })
    testFixture.ctx.role = 'admin'
    await expect(heartbeatAgent(testFixture.ctx, { id: session.id })).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(endAgent(testFixture.ctx, { id: session.id })).resolves.toMatchObject({ status: 'ended' })
    await expect(
      assertAgentSessionAccess({ ...testFixture.ctx, workspaceId: 'another' }, session.id),
    ).rejects.toMatchObject({
      kind: 'not_found',
    })
  })
})
