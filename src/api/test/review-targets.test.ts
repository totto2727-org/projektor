import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { configureCore, env } from './fixture-api'
import {
  authHeaders,
  type JsonRpcError,
  type JsonRpcResult,
  seedIssue,
  seedIssueFixture,
  seedToken,
  toolError,
} from './helpers'
import { resetRateLimits } from './rate-limit-reset'

let fixture: Awaited<ReturnType<typeof seedIssueFixture>>
let attachmentId: string

beforeEach(async () => {
  await configureCore({ RATE_LIMIT_API_MAX: '100', RATE_LIMIT_AUTH_MAX: '100' })
  fixture = await seedIssueFixture()
  attachmentId = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO attachments
    (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at)
    VALUES (?,?,'url','','Design','',0,'https://example.test','issue',?,?,1)`)
    .bind(attachmentId, fixture.workspaceId, fixture.issueId, fixture.userId)
    .run()
})

function update(status: unknown, options: { token?: string; issueId?: string; id?: string } = {}) {
  return SELF.fetch(`http://localhost/api/files/${options.id ?? attachmentId}/review-status`, {
    method: 'PATCH',
    headers: authHeaders(options.token ?? fixture.token, fixture.slug),
    body: JSON.stringify({ issueId: options.issueId ?? fixture.issueId, status }),
  })
}

async function readMetadata() {
  const response = await SELF.fetch(`http://localhost/api/files/${attachmentId}/metadata`, {
    headers: authHeaders(fixture.token, fixture.slug),
  })
  expect(response.status).toBe(200)
  return response.json()
}

async function mcpUpdate(
  status: unknown,
): Promise<JsonRpcResult<{ content: Array<{ text: string }>; isError?: boolean }> | JsonRpcError> {
  const response = await SELF.fetch(`http://localhost/mcp/${fixture.workspaceId}`, {
    method: 'POST',
    headers: authHeaders(fixture.token, fixture.slug),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'set_attachment_review_status',
        arguments: { issueId: fixture.issueId, attachmentId, status },
      },
    }),
  })
  expect(response.status).toBe(200)
  return response.json()
}

describe('review target MCP tool through the real API and Core Workers', () => {
  it('sets all review statuses and clears selection with canonical metadata readback', async () => {
    for (const status of ['fixing', 'in_review', 'changes_requested', 'done', null]) {
      await resetRateLimits()
      const reply = await mcpUpdate(status)
      expect(reply).not.toHaveProperty('error')
      if ('error' in reply) throw new Error(reply.error.message)
      expect(reply.result.isError).not.toBe(true)
      expect(reply.result.content).toHaveLength(1)
      expect(JSON.parse(reply.result.content[0].text)).toEqual({ ok: true })
      expect(await readMetadata()).toMatchObject({ reviewStatus: status })
    }
  })

  it('returns a safe validation tool error without changing selection', async () => {
    const reply = await mcpUpdate('invalid')
    expect(toolError(reply)?.code).toBe('validation')
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })

  it('denies viewer grants and then revoked visibility without writing', async () => {
    await env.DB.prepare("UPDATE group_project_grants SET role='viewer' WHERE project_id=?")
      .bind(fixture.projectId)
      .run()
    expect(toolError(await mcpUpdate('fixing'))?.code).toBe('forbidden')
    await env.DB.prepare('DELETE FROM group_project_grants WHERE project_id=?').bind(fixture.projectId).run()
    expect(toolError(await mcpUpdate('fixing'))?.code).toBe('not_found')
    expect(await env.DB.prepare('SELECT review_status FROM attachments WHERE id=?').bind(attachmentId).first()).toEqual(
      { review_status: null },
    )
  })
})

describe('review targets REST through the real API and Core Workers', () => {
  it('selects, updates and removes a review target and exposes canonical attachment metadata', async () => {
    expect(await readMetadata()).toMatchObject({ id: attachmentId, kind: 'url', reviewStatus: null })
    for (const status of ['fixing', 'in_review', 'changes_requested', 'done', null]) {
      await resetRateLimits()
      const response = await update(status)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(await readMetadata()).toMatchObject({ id: attachmentId, reviewStatus: status })
    }
  })

  it.each(['invalid', '', 1, {}])('rejects malformed review status %j without a write', async (status) => {
    expect((await update(status)).status).toBe(400)
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })

  it('rejects malformed JSON and missing status', async () => {
    for (const body of ['{', JSON.stringify({ issueId: fixture.issueId })]) {
      const response = await SELF.fetch(`http://localhost/api/files/${attachmentId}/review-status`, {
        method: 'PATCH',
        headers: authHeaders(fixture.token, fixture.slug),
        body,
      })
      expect(response.status).toBe(400)
    }
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })

  it('rejects an attachment belonging to another issue even in the same project', async () => {
    const sibling = await seedIssue(fixture.workspaceId, fixture.projectId, fixture.userId)
    expect((await update('fixing', { issueId: sibling.id })).status).toBe(404)
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })

  it('treats the path attachment id as authoritative instead of a body override', async () => {
    const response = await SELF.fetch('http://localhost/api/files/missing-review-target/review-status', {
      method: 'PATCH',
      headers: authHeaders(fixture.token, fixture.slug),
      body: JSON.stringify({ issueId: fixture.issueId, attachmentId, status: 'fixing' }),
    })
    expect(response.status).toBe(404)
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })

  it('confines workspace-bound credentials despite a foreign issue and attachment pair', async () => {
    const other = await seedIssueFixture()
    const foreignAttachmentId = crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO attachments
      (id,workspace_id,kind,r2_key,filename,content_type,size,entity_type,entity_id,created_by_id,created_at)
      VALUES (?,?,'file','other/key','Other','text/plain',1,'issue',?,?,1)`)
      .bind(foreignAttachmentId, other.workspaceId, other.issueId, other.userId)
      .run()
    expect((await update('fixing', { issueId: other.issueId, id: foreignAttachmentId })).status).toBe(404)
    expect(
      await env.DB.prepare('SELECT review_status FROM attachments WHERE id=?').bind(foreignAttachmentId).first(),
    ).toEqual({ review_status: null })
  })

  it('rechecks current project viewer grants and revoked visibility', async () => {
    await env.DB.prepare("UPDATE group_project_grants SET role='viewer' WHERE project_id=?")
      .bind(fixture.projectId)
      .run()
    expect((await update('fixing')).status).toBe(403)
    await env.DB.prepare('DELETE FROM group_project_grants WHERE project_id=?').bind(fixture.projectId).run()
    expect((await update('fixing')).status).toBe(404)
    expect(await env.DB.prepare('SELECT review_status FROM attachments WHERE id=?').bind(attachmentId).first()).toEqual(
      { review_status: null },
    )
  })

  it('rejects read-only credentials without writing', async () => {
    const readOnly = await seedToken(fixture.workspaceId, fixture.userId, { scopes: ['projektor:read'] })
    expect((await update('fixing', { token: readOnly })).status).toBe(403)
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })

  it('rejects current membership revocation without writing', async () => {
    await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?')
      .bind(fixture.workspaceId, fixture.userId)
      .run()
    expect((await update('fixing')).status).toBe(403)
    expect(await env.DB.prepare('SELECT review_status FROM attachments WHERE id=?').bind(attachmentId).first()).toEqual(
      { review_status: null },
    )
  })

  it('does not select Wiki references for review', async () => {
    await env.DB.prepare("UPDATE attachments SET kind='wiki_ref' WHERE id=?").bind(attachmentId).run()
    expect((await update('fixing')).status).toBe(404)
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })

  it('does not mutate archived projects', async () => {
    await env.DB.prepare('UPDATE projects SET archived_at=2 WHERE id=?').bind(fixture.projectId).run()
    expect((await update('fixing')).status).toBe(404)
    expect(await readMetadata()).toMatchObject({ reviewStatus: null })
  })
})
