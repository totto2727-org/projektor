import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vite-plus/test'

import { listMessages, postMessage } from '#commands/agent-messages'
import { registerAgent } from '#commands/agents'
import { claimFiles, releaseFiles } from '#commands/file-claims'
import { claimIssue, releaseIssue } from '#commands/issue-leases'
import type { ServiceCtx } from '#commands/types'

import { seedFixture, seedGroupGrant, seedIssue, seedProject } from './helpers'

async function fixture() {
  const f = await seedFixture({ role: 'member' })
  const project = await seedProject(f.workspace.id)
  const issue = await seedIssue(f.workspace.id, project.id, f.user.id)
  const ctx: ServiceCtx = {
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    workspaceId: f.workspace.id,
    userId: f.user.id,
    role: 'member',
  }
  return { ...f, project, issue, ctx }
}

describe('coordination project authorization', () => {
  it('does not expose or displace a hidden project claim through a visible issue', async () => {
    const f = await fixture()
    await seedGroupGrant(f.workspace.id, f.user.id, f.project.id, 'member')
    const hiddenProject = await seedProject(f.workspace.id, 'HIDDEN')
    const hiddenIssue = await seedIssue(f.workspace.id, hiddenProject.id, f.user.id)
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO issue_file_claims (id,workspace_id,issue_id,path,claimed_at)
      VALUES (?, ?, ?, 'src/shared.ts', ?)`)
      .bind(id, f.workspace.id, hiddenIssue.id, Math.floor(Date.now() / 1000))
      .run()
    for (const force of [false, true]) {
      await expect(claimFiles(f.ctx, { issueId: f.issue.id, paths: ['src/shared.ts'], force })).rejects.toMatchObject({
        kind: 'not_found',
      })
    }
    await expect(releaseFiles(f.ctx, { paths: ['src/shared.ts'] })).rejects.toMatchObject({ kind: 'not_found' })
    expect(
      await env.DB.prepare('SELECT released_at FROM issue_file_claims WHERE id = ?').bind(id).first(),
    ).toMatchObject({ released_at: null })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM claim_conflicts WHERE workspace_id = ?')
        .bind(f.workspace.id)
        .first(),
    ).toMatchObject({ n: 0 })
  })

  it('rejects hidden project coordination before any side effect', async () => {
    const f = await fixture()
    const actions = [
      () => registerAgent(f.ctx, { name: 'agent', issueId: f.issue.id }),
      () => claimIssue(f.ctx, { issueId: f.issue.id, agentId: crypto.randomUUID() }),
      () => releaseIssue(f.ctx, { issueId: f.issue.id }),
      () => claimFiles(f.ctx, { issueId: f.issue.id, paths: ['src/a.ts'] }),
      () => releaseFiles(f.ctx, { issueId: f.issue.id, paths: ['src/a.ts'] }),
      () => postMessage(f.ctx, { scope: `issue:${f.issue.id}`, body: 'secret' }),
      () => listMessages(f.ctx, { scope: `issue:${f.issue.id}` }),
    ]
    for (const action of actions) await expect(action()).rejects.toMatchObject({ kind: 'not_found' })
    for (const table of ['agent_sessions', 'issue_leases', 'issue_file_claims', 'agent_messages']) {
      expect(
        await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`).bind(f.workspace.id).first(),
      ).toMatchObject({ n: 0 })
    }
  })

  it('lets a workspace viewer use an effective member grant, then blocks mutations after downgrade', async () => {
    const f = await fixture()
    await seedGroupGrant(f.workspace.id, f.user.id, f.project.id, 'member')
    f.ctx.role = 'viewer'
    const claim = await claimFiles(f.ctx, { issueId: f.issue.id, paths: ['src/a.ts'] })
    expect(claim.created).toHaveLength(1)
    await postMessage(f.ctx, { scope: `issue:${f.issue.id}`, body: 'visible' })
    await env.DB.prepare('UPDATE group_project_grants SET role = ? WHERE project_id = ?')
      .bind('viewer', f.project.id)
      .run()
    await expect(claimFiles(f.ctx, { issueId: f.issue.id, paths: ['src/b.ts'] })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(releaseFiles(f.ctx, { paths: ['src/a.ts'] })).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(postMessage(f.ctx, { scope: `issue:${f.issue.id}`, body: 'blocked' })).rejects.toMatchObject({
      kind: 'forbidden',
    })
    expect(await listMessages(f.ctx, { scope: `issue:${f.issue.id}` })).toMatchObject({ items: [{ body: 'visible' }] })
  })
})
