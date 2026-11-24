import { describe, expect, test } from 'vite-plus/test'

import { listMessages, postMessage } from '#commands/agent-messages.ts'
import { registerAgent } from '#commands/agents.ts'
import { claimFiles, releaseFiles } from '#commands/file-claims.ts'
import { claimIssue, releaseIssue } from '#commands/issue-leases.ts'
import type { ServiceCtx } from '#commands/types.ts'

import { env } from './fixture-api.ts'
import { seedFixture, seedGroupGrant, seedIssue, seedProject } from './helpers.ts'

const fixture = async function fixture() {
  const testFixture = await seedFixture({ role: 'member' })
  const project = await seedProject(testFixture.workspace.id)
  const issue = await seedIssue(testFixture.workspace.id, project.id, testFixture.user.id)
  const ctx: ServiceCtx = {
    db: env.DB,
    kv: env.KV,
    r2: env.R2,
    workspaceId: testFixture.workspace.id,
    userId: testFixture.user.id,
    role: 'member',
  }
  return { ...testFixture, project, issue, ctx }
}

describe('coordination project authorization', () => {
  test('does not expose or displace a hidden project claim through a visible issue', async () => {
    const testFixture = await fixture()
    await seedGroupGrant(testFixture.workspace.id, testFixture.user.id, testFixture.project.id, 'member')
    const hiddenProject = await seedProject(testFixture.workspace.id, 'HIDDEN')
    const hiddenIssue = await seedIssue(testFixture.workspace.id, hiddenProject.id, testFixture.user.id)
    const id = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO issue_file_claims (id,workspace_id,issue_id,path,claimed_at)
      VALUES (?, ?, ?, 'src/shared.ts', ?)`)
      .bind(id, testFixture.workspace.id, hiddenIssue.id, Math.floor(Date.now() / 1000))
      .run()
    for (const force of [false, true]) {
      await expect(
        claimFiles(testFixture.ctx, { issueId: testFixture.issue.id, paths: ['src/shared.ts'], force }),
      ).rejects.toMatchObject({
        kind: 'not_found',
      })
    }
    await expect(releaseFiles(testFixture.ctx, { paths: ['src/shared.ts'] })).rejects.toMatchObject({
      kind: 'not_found',
    })
    await expect(
      env.DB.prepare('SELECT released_at FROM issue_file_claims WHERE id = ?').bind(id).first(),
    ).resolves.toMatchObject({ released_at: null })
    await expect(
      env.DB.prepare('SELECT COUNT(*) AS n FROM claim_conflicts WHERE workspace_id = ?')
        .bind(testFixture.workspace.id)
        .first(),
    ).resolves.toMatchObject({ n: 0 })
  })

  test('rejects hidden project coordination before any side effect', async () => {
    const testFixture = await fixture()
    const actions = [
      () => registerAgent(testFixture.ctx, { name: 'agent', issueId: testFixture.issue.id }),
      () => claimIssue(testFixture.ctx, { issueId: testFixture.issue.id, agentId: crypto.randomUUID() }),
      () => releaseIssue(testFixture.ctx, { issueId: testFixture.issue.id }),
      () => claimFiles(testFixture.ctx, { issueId: testFixture.issue.id, paths: ['src/a.ts'] }),
      () => releaseFiles(testFixture.ctx, { issueId: testFixture.issue.id, paths: ['src/a.ts'] }),
      () => postMessage(testFixture.ctx, { scope: `issue:${testFixture.issue.id}`, body: 'secret' }),
      () => listMessages(testFixture.ctx, { scope: `issue:${testFixture.issue.id}` }),
    ]
    for (const action of actions) {
      await expect(action()).rejects.toMatchObject({ kind: 'not_found' })
    }
    for (const table of ['agent_sessions', 'issue_leases', 'issue_file_claims', 'agent_messages']) {
      await expect(
        env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`)
          .bind(testFixture.workspace.id)
          .first(),
      ).resolves.toMatchObject({ n: 0 })
    }
  })

  test('lets a workspace viewer use an effective member grant, then blocks mutations after downgrade', async () => {
    const testFixture = await fixture()
    await seedGroupGrant(testFixture.workspace.id, testFixture.user.id, testFixture.project.id, 'member')
    testFixture.ctx.role = 'viewer'
    const claim = await claimFiles(testFixture.ctx, { issueId: testFixture.issue.id, paths: ['src/a.ts'] })
    expect(claim.created).toHaveLength(1)
    await postMessage(testFixture.ctx, { scope: `issue:${testFixture.issue.id}`, body: 'visible' })
    await env.DB.prepare('UPDATE group_project_grants SET role = ? WHERE project_id = ?')
      .bind('viewer', testFixture.project.id)
      .run()
    await expect(
      claimFiles(testFixture.ctx, { issueId: testFixture.issue.id, paths: ['src/b.ts'] }),
    ).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(releaseFiles(testFixture.ctx, { paths: ['src/a.ts'] })).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(
      postMessage(testFixture.ctx, { scope: `issue:${testFixture.issue.id}`, body: 'blocked' }),
    ).rejects.toMatchObject({
      kind: 'forbidden',
    })
    await expect(listMessages(testFixture.ctx, { scope: `issue:${testFixture.issue.id}` })).resolves.toMatchObject({
      items: [{ body: 'visible' }],
    })
  })
})
