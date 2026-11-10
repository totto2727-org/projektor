import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { assertAgentSessionAccess } from '#commands/agent-identity'
import { postMessage } from '#commands/agent-messages'
import { endAgent, finishWork, heartbeatAgent, registerAgent } from '#commands/agents'
import { claimFiles, releaseFiles } from '#commands/file-claims'
import { claimIssue, releaseIssue } from '#commands/issue-leases'
import { updateIssue } from '#commands/issues'
import type { ServiceCtx } from '#commands/types'

import { createTestDatabase } from '../../web/test/database'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
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
    kv: { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() } as unknown as KVNamespace,
    r2: {} as R2Bucket,
    workspaceId: 'w',
    userId: 'u',
    role: 'member',
    auth: { kind: 'agent', method: 'oauth', credentialId: 'grant-a' },
  }
  return { ...database, ctx, issueId }
}

describe('agent session ownership at shared command boundaries', () => {
  it('uses a legacy token owner only when no newer credential owner exists', async () => {
    const f = fixture()
    f.sqlite.exec(`INSERT INTO api_tokens (id,workspace_id,user_id,name,token_hash,scopes,created_at)
      VALUES ('token-a','w','u','Token','hash','["*"]',1)`)
    f.ctx.auth = { kind: 'agent', method: 'pat', credentialId: 'token-a' }
    const session = await registerAgent(f.ctx, { name: 'legacy' })
    f.sqlite.prepare('UPDATE agent_sessions SET credential_id = NULL WHERE id = ?').run(session.id)
    expect(await heartbeatAgent(f.ctx, {})).toMatchObject({ id: session.id })
    f.sqlite.prepare("UPDATE agent_sessions SET credential_id = 'different-owner' WHERE id = ?").run(session.id)
    await expect(heartbeatAgent(f.ctx, { id: session.id })).rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('rejects explicit cross-credential impersonation and release omissions before any mutation', async () => {
    const f = fixture()
    const session = await registerAgent(f.ctx, { name: 'holder', issueId: f.issueId })
    await claimIssue(f.ctx, { issueId: f.issueId, agentId: session.id })
    await claimFiles(f.ctx, { issueId: f.issueId, agentId: session.id, paths: ['src/a.ts'] })
    f.sqlite
      .prepare('UPDATE agent_sessions SET last_heartbeat_at = ? WHERE id = ?')
      .run(Math.floor(Date.now() / 1000) - 10, session.id)
    const before = f.sqlite.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(session.id)
    const other: ServiceCtx = { ...f.ctx, auth: { kind: 'agent', method: 'oauth', credentialId: 'grant-b' } }
    const actions = [
      () => heartbeatAgent(other, { id: session.id }),
      () => endAgent(other, { id: session.id }),
      () => claimIssue(other, { issueId: f.issueId, agentId: session.id }),
      () => claimFiles(other, { issueId: f.issueId, agentId: session.id, paths: ['src/b.ts'] }),
      () => postMessage(other, { scope: `issue:${f.issueId}`, agentId: session.id, body: 'spoofed' }),
      () => releaseIssue(other, { issueId: f.issueId }),
      () => releaseFiles(other, { paths: ['src/a.ts'] }),
      () => updateIssue(other, f.issueId, { title: 'Spoofed', agentSessionId: session.id }),
      () =>
        finishWork(other, {
          sessionId: session.id,
          issue: f.issueId,
          completionReport: { summary: 'Spoofed', verification: 'Not performed' },
        }),
    ]
    for (const action of actions) await expect(action()).rejects.toMatchObject({ kind: 'forbidden' })
    expect(f.sqlite.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(session.id)).toEqual(before)
    expect(f.sqlite.prepare('SELECT title FROM issues WHERE id = ?').get(f.issueId)).toMatchObject({
      title: 'Original',
    })
    expect(f.sqlite.prepare('SELECT released_at FROM issue_leases WHERE issue_id = ?').get(f.issueId)).toMatchObject({
      released_at: null,
    })
    expect(
      f.sqlite.prepare('SELECT released_at FROM issue_file_claims WHERE issue_id = ?').get(f.issueId),
    ).toMatchObject({ released_at: null })
  })

  it('preserves shared-credential fleet operations but applies current project grants', async () => {
    const f = fixture()
    const first = await registerAgent(f.ctx, { name: 'one', issueId: f.issueId })
    const second = await registerAgent(f.ctx, { name: 'two', issueId: f.issueId })
    expect(await heartbeatAgent(f.ctx, { id: first.id })).toMatchObject({ id: first.id })
    expect(await heartbeatAgent(f.ctx, { id: second.id })).toMatchObject({ id: second.id })
    f.sqlite.exec("DELETE FROM group_project_grants WHERE project_id = 'p'")
    await expect(heartbeatAgent(f.ctx, { id: first.id })).rejects.toMatchObject({ kind: 'not_found' })
    await expect(endAgent(f.ctx, { id: second.id })).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('records new human ownership without inferring ownership of legacy null sessions', async () => {
    const f = fixture()
    f.ctx.auth = { kind: 'human', method: 'access' }
    const session = await registerAgent(f.ctx, { name: 'browser' })
    expect(
      f.sqlite.prepare('SELECT credential_id,token_id FROM agent_sessions WHERE id = ?').get(session.id),
    ).toMatchObject({ credential_id: 'user:u', token_id: null })
    expect(await heartbeatAgent(f.ctx, {})).toMatchObject({ id: session.id })
    f.sqlite.prepare('UPDATE agent_sessions SET credential_id = NULL WHERE id = ?').run(session.id)
    await expect(heartbeatAgent(f.ctx, { id: session.id })).rejects.toMatchObject({ kind: 'forbidden' })
    f.ctx.role = 'admin'
    expect(await endAgent(f.ctx, { id: session.id })).toMatchObject({ status: 'ended' })
    await expect(assertAgentSessionAccess({ ...f.ctx, workspaceId: 'another' }, session.id)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })
})
