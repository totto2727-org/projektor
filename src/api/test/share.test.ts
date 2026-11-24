import { Schema } from 'effect'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import {
  authHeaders,
  hashToken,
  seedFixture,
  seedGroupGrant,
  seedIssue,
  seedIssueFixture,
  seedProject,
} from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'
import { TokenLinkResponse, TokenResponse, readNativeJson } from './response-json.ts'

describe('share tokens', () => {
  let token: string
  let slug: string
  let workspaceId: string
  let userId: string
  let issueId: string

  beforeEach(async () => {
    ;({ token, slug, workspaceId, userId, issueId } = await seedIssueFixture({
      issueTitle: 'Shareable issue',
    }))
  })

  test('handles POST /api/issues/:id/share creates a token and returns { token, url }', async () => {
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(201)
    const body = await readNativeJson(res, TokenLinkResponse)
    expect(typeof body.token).toBe('string')
    expect(body.token).toHaveLength(32)
    expect(body.url).toBe(`/share/${body.token}`)
  })

  test('handles GET /api/share/:token returns issue data without auth', async () => {
    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
    expect(res.status).toBe(200)
    const data = await readNativeJson(
      res,
      Schema.Struct({
        customFields: Schema.Array(Schema.Unknown).pipe(Schema.mutable),
        priority: Schema.String,
        title: Schema.String,
      }),
    )
    expect(data.title).toBe('Shareable issue')
    expect(data.priority).toBeDefined()
    expect(Array.isArray(data.customFields)).toBe(true)
  })

  test('handles GET /api/share/<expired-token> returns 404', async () => {
    const now = currentEpochSeconds()
    const expiredToken = '00000000000000000000000000000001'
    const { env } = await import('./fixture-api.ts')
    await env.DB.prepare(
      'INSERT INTO share_tokens (id, issue_id, workspace_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(await hashToken(expiredToken), issueId, workspaceId, userId, now - 1, now - 86_400)
      .run()

    const res = await fetchNativeApi(`http://localhost/api/share/${expiredToken}`)
    expect(res.status).toBe(404)
  })

  test('stores the share token hashed, not in plaintext, in D1', async () => {
    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const { env } = await import('./fixture-api.ts')
    const row = await env.DB.prepare('SELECT id FROM share_tokens WHERE issue_id = ?')
      .bind(issueId)
      .first<{ id: string }>()

    expect(row?.id).not.toBe(shareToken)
    expect(row?.id).toBe(await hashToken(shareToken))
  })

  test('handles GET /api/share/<unknown-token> returns 404', async () => {
    const res = await fetchNativeApi('http://localhost/api/share/ffffffffffffffffffffffffffffffff')
    expect(res.status).toBe(404)
  })

  test('handles POST /api/issues/:id/share returns 404 for issue in another workspace', async () => {
    const other = await seedFixture()
    const res = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(other.token, other.workspace.slug),
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  test('handles POST /api/issues/:id/share returns 404 for a nonexistent issue ID', async () => {
    const res = await fetchNativeApi('http://localhost/api/issues/00000000-0000-0000-0000-000000000000/share', {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  test('handles GET /api/share/:token returns project_key, project_name, and status_name', async () => {
    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
    expect(res.status).toBe(200)
    const data = await readNativeJson(
      res,
      Schema.Struct({
        expires_at: Schema.Number,
        project_key: Schema.Union([Schema.String, Schema.Null]),
        project_name: Schema.Union([Schema.String, Schema.Null]),
        status_name: Schema.Union([Schema.String, Schema.Null]),
      }),
    )
    expect(data.project_key).toBe('PROJ')
    expect(data.project_name).toBeDefined()
    expect('status_name' in data).toBe(true)
    expect(typeof data.expires_at).toBe('number')
  })

  test('handles GET /api/share/:token is reusable — multiple requests all return 200', async () => {
    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    for (let index = 0; index < 3; index += 1) {
      const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
      expect(res.status).toBe(200)
    }
  })

  test('covers PROJ-240: viewer role cannot create a share link', async () => {
    const viewerFixture = await seedIssueFixture({ role: 'viewer' })
    const res = await fetchNativeApi(`http://localhost/api/issues/${viewerFixture.issueId}/share`, {
      headers: authHeaders(viewerFixture.token, viewerFixture.slug),
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  test('covers PROJ-241: public share payload excludes internal custom fields, includes non-internal ones', async () => {
    const { env } = await import('./fixture-api.ts')
    const now = currentEpochSeconds()

    const internalFieldId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO custom_field_definitions (id, workspace_id, project_id, key, label, type, ' +
        "options, created_at, is_internal) VALUES (?, ?, NULL, ?, ?, 'text', NULL, ?, 1)",
    )
      .bind(internalFieldId, workspaceId, 'secret_notes', 'Secret Notes', now)
      .run()
    await env.DB.prepare('INSERT INTO custom_field_values (issue_id, field_id, value) VALUES (?, ?, ?)')
      .bind(issueId, internalFieldId, 'confidential')
      .run()

    const publicFieldId = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO custom_field_definitions (id, workspace_id, project_id, key, label, type, ' +
        "options, created_at, is_internal) VALUES (?, ?, NULL, ?, ?, 'text', NULL, ?, 0)",
    )
      .bind(publicFieldId, workspaceId, 'public_note', 'Public Note', now)
      .run()
    await env.DB.prepare('INSERT INTO custom_field_values (issue_id, field_id, value) VALUES (?, ?, ?)')
      .bind(issueId, publicFieldId, 'hello world')
      .run()

    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
    expect(res.status).toBe(200)
    const dataShape = Schema.Struct({
      customFields: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })).pipe(Schema.mutable),
    })
    const data = await readNativeJson(res, dataShape)
    expect(data.customFields.some((field) => field.key === 'secret_notes')).toBe(false)
    expect(data.customFields.some((field) => field.key === 'public_note')).toBe(true)
  })

  test('covers PROJ-242: revokes a share token so it no longer resolves', async () => {
    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const revokeRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'DELETE',
    })
    expect(revokeRes.status).toBe(200)

    const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
    expect(res.status).toBe(404)
  })

  test("covers PROJ-762: GET /api/share/:token includes the owning workspace's brand", async () => {
    const owner = await seedIssueFixture({ role: 'owner' })
    const patchRes = await fetchNativeApi(
      `http://localhost/api/workspaces/${owner.slug}/brand`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(owner.token, owner.slug),
        JSON.stringify({ accent: '#ff8800', displayName: 'Acme Tracker' }),
      ),
    )
    expect(patchRes.status).toBe(200)

    const createRes = await fetchNativeApi(`http://localhost/api/issues/${owner.issueId}/share`, {
      headers: authHeaders(owner.token, owner.slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
    expect(res.status).toBe(200)
    const dataShape = Schema.Struct({
      brand: Schema.Struct({
        accent: Schema.Union([Schema.String, Schema.Null]),
        displayName: Schema.Union([Schema.String, Schema.Null]),
        logoUrl: Schema.Union([Schema.String, Schema.Null]),
      }),
    })
    const data = await readNativeJson(res, dataShape)
    expect(data.brand.displayName).toBe('Acme Tracker')
    expect(data.brand.accent).toBe('#ff8800')
    expect(data.brand.logoUrl).toBeNull()
  })

  test('covers PROJ-762: GET /api/share/:token returns a null-fielded brand when the workspace has none set', async () => {
    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
    expect(res.status).toBe(200)
    const dataShape = Schema.Struct({
      brand: Schema.Struct({
        accent: Schema.Union([Schema.String, Schema.Null]),
        displayName: Schema.Union([Schema.String, Schema.Null]),
      }),
    })
    const data = await readNativeJson(res, dataShape)
    expect(data.brand.displayName).toBeNull()
    expect(data.brand.accent).toBeNull()
  })

  test('review finding 1: GET /api/share/:token/logo serves the workspace logo with no auth', async () => {
    const owner = await seedIssueFixture({ role: 'owner' })
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const form = new FormData()
    form.append('file', new File([pngBytes], 'logo.png', { type: 'image/png' }))
    const ownerAuth = authHeaders(owner.token, owner.slug)
    const uploadRes = await fetchNativeApi(`http://localhost/api/workspaces/${owner.slug}/brand/logo`, {
      body: form,
      headers: { Authorization: ownerAuth.Authorization, 'X-Workspace-Slug': owner.slug },
      method: 'POST',
    })
    expect(uploadRes.status).toBe(201)

    const createRes = await fetchNativeApi(`http://localhost/api/issues/${owner.issueId}/share`, {
      headers: authHeaders(owner.token, owner.slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const shareRes = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
    const shareDataShape = Schema.Struct({
      brand: Schema.Struct({ logoUrl: Schema.Union([Schema.String, Schema.Null]) }),
    })
    const shareData = await readNativeJson(shareRes, shareDataShape)
    expect(shareData.brand.logoUrl).toBe(`/api/share/${shareToken}/logo`)

    const logoRes = await fetchNativeApi(`http://localhost${shareData.brand.logoUrl}`)
    expect(logoRes.status).toBe(200)
    expect(logoRes.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await logoRes.arrayBuffer())).toStrictEqual(pngBytes)
  })

  test('review finding 1: GET /api/share/:token/logo 404s when the workspace has no logo set', async () => {
    const createRes = await fetchNativeApi(`http://localhost/api/issues/${issueId}/share`, {
      headers: authHeaders(token, slug),
      method: 'POST',
    })
    const { token: shareToken } = await readNativeJson(createRes, TokenLinkResponse)

    const res = await fetchNativeApi(`http://localhost/api/share/${shareToken}/logo`)
    expect(res.status).toBe(404)
  })

  test('review finding 1: GET /api/share/<unknown-token>/logo 404s', async () => {
    const res = await fetchNativeApi('http://localhost/api/share/ffffffffffffffffffffffffffffffff/logo')
    expect(res.status).toBe(404)
  })

  test('covers PROJ-242: viewer role cannot revoke a share link', async () => {
    const viewerFixture = await seedIssueFixture({ role: 'viewer' })
    const { env } = await import('./fixture-api.ts')
    const now = currentEpochSeconds()
    await env.DB.prepare(
      'INSERT INTO share_tokens (id, issue_id, workspace_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(
        await hashToken('11111111111111111111111111111111'),
        viewerFixture.issueId,
        viewerFixture.workspaceId,
        viewerFixture.userId,
        now + 86_400,
        now,
      )
      .run()

    const res = await fetchNativeApi(`http://localhost/api/issues/${viewerFixture.issueId}/share`, {
      headers: authHeaders(viewerFixture.token, viewerFixture.slug),
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })

  describe('covers PROJ-792: share create/revoke honour project-level access', () => {
    const restrictedIssue = async function restrictedIssue(
      grant: 'none' | 'viewer' | 'member',
      workspaceRole = 'member',
    ) {
      const { workspace, user, token } = await seedFixture({ role: workspaceRole })
      const project = await seedProject(workspace.id)
      if (grant !== 'none') {
        await seedGroupGrant(workspace.id, user.id, project.id, grant)
      }
      const issue = await seedIssue(workspace.id, project.id, user.id, { title: 'Restricted' })
      return {
        token,
        slug: workspace.slug,
        workspaceId: workspace.id,
        userId: user.id,
        issueId: issue.id,
      }
    }

    test('member without a grant cannot create a share link (404, existence hidden)', async () => {
      const restrictedFixture = await restrictedIssue('none')
      const res = await fetchNativeApi(`http://localhost/api/issues/${restrictedFixture.issueId}/share`, {
        headers: authHeaders(restrictedFixture.token, restrictedFixture.slug),
        method: 'POST',
      })
      expect(res.status).toBe(404)
      const { env } = await import('./fixture-api.ts')
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_tokens WHERE issue_id = ?')
        .bind(restrictedFixture.issueId)
        .first<{ n: number }>()
      expect(row?.n).toBe(0)
    })

    test("member without a grant cannot revoke someone else's share link", async () => {
      const restrictedFixture = await restrictedIssue('none')
      const { env } = await import('./fixture-api.ts')
      const now = currentEpochSeconds()
      await env.DB.prepare(
        'INSERT INTO share_tokens (id, issue_id, workspace_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(
          await hashToken('victim-link'),
          restrictedFixture.issueId,
          restrictedFixture.workspaceId,
          restrictedFixture.userId,
          now + 3600,
          now,
        )
        .run()
      const res = await fetchNativeApi(`http://localhost/api/issues/${restrictedFixture.issueId}/share`, {
        headers: authHeaders(restrictedFixture.token, restrictedFixture.slug),
        method: 'DELETE',
      })
      expect(res.status).toBe(404)
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_tokens WHERE issue_id = ?')
        .bind(restrictedFixture.issueId)
        .first<{ n: number }>()
      expect(row?.n).toBe(1)
    })

    test('member with only a viewer grant gets 403', async () => {
      const restrictedFixture = await restrictedIssue('viewer')
      const res = await fetchNativeApi(`http://localhost/api/issues/${restrictedFixture.issueId}/share`, {
        headers: authHeaders(restrictedFixture.token, restrictedFixture.slug),
        method: 'POST',
      })
      expect(res.status).toBe(403)
    })

    test('workspace viewer with a member grant on the project can share (grant replaces workspace role)', async () => {
      const restrictedFixture = await restrictedIssue('member', 'viewer')
      const res = await fetchNativeApi(`http://localhost/api/issues/${restrictedFixture.issueId}/share`, {
        headers: authHeaders(restrictedFixture.token, restrictedFixture.slug),
        method: 'POST',
      })
      expect(res.status).toBe(201)
    })
  })

  /*
   * PROJ-794: a share link dies with its issue, its project's archival, or its
   * creator's access — checked every time the link is read.
   */
  describe("covers PROJ-794: share links stop resolving when the issue or the creator's access goes", () => {
    const sharedIssue = async function sharedIssue(workspaceRole: string, grant: 'none' | 'member') {
      const { workspace, user, token } = await seedFixture({ role: workspaceRole })
      const project = await seedProject(workspace.id)
      const g = grant === 'member' ? await seedGroupGrant(workspace.id, user.id, project.id, 'member') : null
      const issue = await seedIssue(workspace.id, project.id, user.id, { title: 'Shared' })
      const res = await fetchNativeApi(`http://localhost/api/issues/${issue.id}/share`, {
        headers: authHeaders(token, workspace.slug),
        method: 'POST',
      })
      expect(res.status).toBe(201)
      const { token: shareToken } = await readNativeJson(res, TokenResponse)
      return {
        shareToken,
        workspaceId: workspace.id,
        userId: user.id,
        projectId: project.id,
        issueId: issue.id,
        groupId: g?.groupId ?? null,
      }
    }

    const shareStatus = async function shareStatus(shareToken: string): Promise<number> {
      // The public share route is rate-limited too; these tests hit it several times.
      await resetRateLimits()
      const response = await fetchNativeApi(`http://localhost/api/share/${shareToken}`)
      return response.status
    }

    test('404s once the issue is deleted', async () => {
      const sharedFixture = await sharedIssue('admin', 'none')
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(200)
      await env.DB.prepare('DELETE FROM issues WHERE id = ?').bind(sharedFixture.issueId).run()
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(404)
    })

    test("404s once the issue's project is archived", async () => {
      const sharedFixture = await sharedIssue('admin', 'none')
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(200)
      await env.DB.prepare('UPDATE projects SET archived_at = ? WHERE id = ?')
        .bind(currentEpochSeconds(), sharedFixture.projectId)
        .run()
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(404)
    })

    test("404s once the creator's project grant is revoked, and resolves again if restored", async () => {
      const sharedFixture = await sharedIssue('member', 'member')
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(200)

      const grant = await env.DB.prepare('SELECT role FROM group_project_grants WHERE group_id = ? AND project_id = ?')
        .bind(sharedFixture.groupId, sharedFixture.projectId)
        .first<{ role: string }>()
      await env.DB.prepare('DELETE FROM group_project_grants WHERE group_id = ? AND project_id = ?')
        .bind(sharedFixture.groupId, sharedFixture.projectId)
        .run()
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(404)
      await resetRateLimits()
      const apiResponse = await fetchNativeApi(`http://localhost/api/share/${sharedFixture.shareToken}/logo`)
      expect(apiResponse.status).toBe(404)

      await env.DB.prepare('INSERT INTO group_project_grants (group_id, project_id, role) VALUES (?, ?, ?)')
        .bind(sharedFixture.groupId, sharedFixture.projectId, grant?.role ?? 'member')
        .run()
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(200)
    })

    test('404s once the creator is removed from the workspace', async () => {
      const sharedFixture = await sharedIssue('admin', 'none')
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(200)
      await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
        .bind(sharedFixture.workspaceId, sharedFixture.userId)
        .run()
      await expect(shareStatus(sharedFixture.shareToken)).resolves.toBe(404)
    })
  })
})
