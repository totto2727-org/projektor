import { Effect } from 'effect'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { configureCore, env } from '../../src/api/test/fixture-api'
import { CommandOkSchema, type BrowserCommand } from '../../src/core/web/command-contract'

let proof: BrowserCommand
let issueId: string
let attachmentId: string
let workspaceId: string
let projectId: string
let groupId: string

beforeEach(async () => {
  const suffix = crypto.randomUUID()
  const userId = `review-user-${suffix}`
  workspaceId = `review-workspace-${suffix}`
  projectId = `review-project-${suffix}`
  groupId = `review-group-${suffix}`
  issueId = `review-issue-${suffix}`
  attachmentId = `review-attachment-${suffix}`
  const email = `review-${suffix}@example.test`
  const slug = `review-${suffix}`
  await configureCore({ DEV_USER_EMAIL: email, DEFAULT_WORKSPACE_SLUG: slug, RATE_LIMIT_AUTH_MAX: '100' })
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,1)').bind(userId, email, 'Reviewer'),
    env.DB.prepare('INSERT INTO workspaces (id,name,slug,created_at) VALUES (?,?,?,1)').bind(
      workspaceId,
      'Review',
      slug,
    ),
    env.DB.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES (?,?,'member',1)").bind(
      workspaceId,
      userId,
    ),
    env.DB.prepare(
      "INSERT INTO projects (id,workspace_id,name,key,created_at,updated_at) VALUES (?,?,'Review','REV',1,1)",
    ).bind(projectId, workspaceId),
    env.DB.prepare("INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES (?,?,'Review',1)").bind(
      groupId,
      workspaceId,
    ),
    env.DB.prepare('INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES (?,?,?,1)').bind(
      groupId,
      userId,
      userId,
    ),
    env.DB.prepare("INSERT INTO group_project_grants (group_id,project_id,role) VALUES (?,?,'member')").bind(
      groupId,
      projectId,
    ),
    env.DB.prepare(
      "INSERT INTO issues (id,workspace_id,project_id,number,title,status,priority,created_by_id,created_at,updated_at) VALUES (?,?,?,1,'Review issue','backlog','medium',?,1,1)",
    ).bind(issueId, workspaceId, projectId, userId),
    env.DB.prepare(
      "INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at) VALUES (?,?,'url','','Design','',0,'https://example.test','issue',?,?,1)",
    ).bind(attachmentId, workspaceId, issueId, userId),
  ])
  proof = {
    workspaceSlug: slug,
    request: { url: 'https://front.test/_effront/query', method: 'POST', headers: [['origin', 'https://front.test']] },
  }
})

function update(status: unknown, command = proof, owner = issueId) {
  return Effect.runPromise(
    decodeCoreReply(
      CommandOkSchema,
      makeCoreClient(Reflect.get(env, 'CORE')).webSetAttachmentReviewStatus(command, {
        issueId: owner,
        attachmentId,
        status,
      }),
    ),
  )
}

async function persistedStatus() {
  return env.DB.prepare('SELECT review_status FROM attachments WHERE id = ? AND workspace_id = ?')
    .bind(attachmentId, workspaceId)
    .first()
}

describe('native named review target browser command', () => {
  it('persists nullable review transitions across the actual Core service binding', async () => {
    expect(await persistedStatus()).toEqual({ review_status: null })
    for (const status of ['fixing', 'in_review', 'changes_requested', 'done', null]) {
      expect(await update(status)).toEqual({ ok: true })
      expect(await persistedStatus()).toEqual({ review_status: status })
    }
  })

  it('rejects cross-origin native commands without writing', async () => {
    await expect(
      update('fixing', { ...proof, request: { ...proof.request, headers: [['origin', 'https://evil.test']] } }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await persistedStatus()).toEqual({ review_status: null })
  })

  it('rejects malformed statuses and issue ownership mismatches safely', async () => {
    await expect(update('invalid')).rejects.toMatchObject({ status: 400 })
    await expect(update('fixing', proof, 'missing-issue')).rejects.toMatchObject({ status: 404 })
    expect(await persistedStatus()).toEqual({ review_status: null })
  })

  it('rechecks viewer and revoked project grants in the native Core invocation', async () => {
    await env.DB.prepare("UPDATE group_project_grants SET role = 'viewer' WHERE group_id = ?").bind(groupId).run()
    await expect(update('fixing')).rejects.toMatchObject({ status: 403 })
    await env.DB.prepare('DELETE FROM group_project_grants WHERE group_id = ?').bind(groupId).run()
    await expect(update('fixing')).rejects.toMatchObject({ status: 404 })
    expect(await persistedStatus()).toEqual({ review_status: null })
  })

  it('rejects archived projects while preserving the selected status', async () => {
    await update('fixing')
    await env.DB.prepare('UPDATE projects SET archived_at = 2 WHERE id = ?').bind(projectId).run()
    await expect(update('done')).rejects.toMatchObject({ status: 404 })
    expect(await persistedStatus()).toEqual({ review_status: 'fixing' })
  })

  it('requires current workspace membership on every native command', async () => {
    await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').bind(workspaceId).run()
    await expect(update('fixing')).rejects.toMatchObject({ status: 403 })
    expect(await persistedStatus()).toEqual({ review_status: null })
  })
})
