import { Predicate } from 'effect'

import { currentEpochSeconds } from '#contracts/time.ts'
import { SQL_NULL } from '#db/sql-null.ts'

import { env } from './fixture-api.ts'

export interface JsonRpcResult<T = unknown> {
  jsonrpc: '2.0'
  id: unknown
  result: T
}
export interface JsonRpcError {
  jsonrpc: '2.0'
  id: unknown
  error: { code: number; message: string; data?: unknown }
}

export const hashToken = async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const seedWorkspace = async function seedWorkspace(slug = `test-ws-${crypto.randomUUID().slice(0, 8)}`) {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare('INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, 'Test Workspace', slug, now)
    .run()
  return { id, slug }
}

export const seedUser = async function seedUser(email = 'user@example.com') {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, email, 'Test User', now)
    .run()
  return { id, email }
}

export const seedMember = async function seedMember(
  workspaceId: string,
  userId: string,
  role = 'member',
): Promise<void> {
  const now = currentEpochSeconds()
  await env.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .bind(workspaceId, userId, role, now)
    .run()
}

export const seedToken = async function seedToken(
  workspaceId: string,
  userId: string,
  opts?: Readonly<{ scopes?: string[]; expiresAt?: number }>,
): Promise<string> {
  const raw = `tok_${crypto.randomUUID().replaceAll('-', '')}`
  const hash = await hashToken(raw)
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, workspace_id, user_id, name, token_hash, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      workspaceId,
      userId,
      'test-token',
      hash,
      JSON.stringify(opts?.scopes ?? ['*']),
      opts?.expiresAt ?? SQL_NULL,
      now,
    )
    .run()
  return raw
}

/**
 * Seed a user-scoped token (NULL workspace_id — valid across all the user's workspaces).
 *
 * @param {string} userId - The ID of the token owner.
 * @param {Readonly<{ scopes?: string[]; expiresAt?: number }>} opts - The token scopes and expiration time.
 * @returns {Promise<string>} The raw token to use in the Authorization header.
 */
export const seedUserToken = async function seedUserToken(
  userId: string,
  opts?: Readonly<{ scopes?: string[]; expiresAt?: number }>,
): Promise<string> {
  const raw = `tok_${crypto.randomUUID().replaceAll('-', '')}`
  const hash = await hashToken(raw)
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, workspace_id, user_id, name, token_hash, scopes, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      SQL_NULL,
      userId,
      'test-user-token',
      hash,
      JSON.stringify(opts?.scopes ?? ['*']),
      opts?.expiresAt ?? SQL_NULL,
      now,
    )
    .run()
  return raw
}

export const seedProject = async function seedProject(workspaceId: string, key = 'PROJ') {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare(
    'INSERT INTO projects (id, workspace_id, name, key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, workspaceId, 'Test Project', key, now, now)
    .run()
  return { id, key }
}

/**
 * PROJ-311: grant a user access to a project by putting them in a fresh group that
 * holds a (project, role) grant. Mirrors what an admin does through the groups UI;
 * used to give non-admin fixtures visibility now that access is default-deny.
 *
 * @param {string} workspaceId - The ID of the workspace for the new group.
 * @param {string} userId - The ID of the group member.
 * @param {string} projectId - The ID of the project that the group can access.
 * @param {string} role - The project role for the group. The default is `member`.
 * @returns {Promise<{ groupId: string }>} The ID of the new group in the `groupId` field.
 */
export const seedGroupGrant = async function seedGroupGrant(
  workspaceId: string,
  userId: string,
  projectId: string,
  role = 'member',
): Promise<{ groupId: string }> {
  const now = currentEpochSeconds()
  const groupId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO user_groups (id, workspace_id, name, description, created_at) VALUES (?, ?, ?, NULL, ?)',
  )
    .bind(groupId, workspaceId, `grp-${groupId.slice(0, 8)}`, now)
    .run()
  await env.DB.prepare('INSERT INTO user_group_members (group_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)')
    .bind(groupId, userId, userId, now)
    .run()
  await env.DB.prepare('INSERT INTO group_project_grants (group_id, project_id, role) VALUES (?, ?, ?)')
    .bind(groupId, projectId, role)
    .run()
  return { groupId }
}

/**
 * Returns headers needed for every authenticated request
 *
 * @param {string} token - The raw token for the Authorization header.
 * @param {string} slug - The workspace slug for the X-Workspace-Slug header.
 * @returns {{ Authorization: string; 'X-Workspace-Slug': string; 'Content-Type': string }} The headers for an authenticated JSON request.
 */
export const authHeaders = function authHeaders(
  token: string,
  slug: string,
): { Authorization: string; 'X-Workspace-Slug': string; 'Content-Type': string } {
  return {
    Authorization: `Bearer ${token}`,
    'X-Workspace-Slug': slug,
    'Content-Type': 'application/json',
  }
}

export const seedComment = async function seedComment(
  issueId: string,
  authorId: string,
  body = 'Test comment',
  authorKind?: 'human' | 'agent',
) {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare(
    'INSERT INTO issue_comments (id, issue_id, author_id, body, created_at, updated_at, ' +
      'author_kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, issueId, authorId, body, now, now, authorKind ?? SQL_NULL)
    .run()
  return { id, body }
}

export const seedTaskType = async function seedTaskType(
  workspaceId: string,
  opts?: Readonly<{
    id?: string
    key?: string
    name?: string
    isDefault?: boolean
    position?: number
  }>,
): Promise<{ id: string; key: string; name: string }> {
  const id = opts?.id ?? crypto.randomUUID()
  const key = opts?.key ?? `type-${id.slice(0, 8)}`
  await env.DB.prepare(
    `INSERT INTO task_types (id, workspace_id, key, name, color, icon, position, is_default)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
  )
    .bind(id, workspaceId, key, opts?.name ?? key, opts?.position ?? 0, opts?.isDefault === true ? 1 : 0)
    .run()
  return { id, key, name: opts?.name ?? key }
}

export const seedTaskStatus = async function seedTaskStatus(
  workspaceId: string,
  opts?: Readonly<{
    key?: string
    name?: string
    category?: string
    isDefault?: boolean
    position?: number
    isReviewStep?: boolean
  }>,
) {
  const id = crypto.randomUUID()
  const key = opts?.key ?? `status-${id.slice(0, 8)}`
  await env.DB.prepare(
    `INSERT INTO task_statuses (id, workspace_id, key, name, category, color, position, is_default, is_review_step)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      key,
      opts?.name ?? key,
      opts?.category ?? 'todo',
      opts?.position ?? 0,
      opts?.isDefault === true ? 1 : 0,
      opts?.isReviewStep === true ? 1 : 0,
    )
    .run()
  return { id, key, name: opts?.name ?? key }
}

export const seedIssue = async function seedIssue(
  workspaceId: string,
  projectId: string,
  createdById: string,
  opts?: Readonly<{
    title?: string
    status?: string
    statusId?: string
    priority?: string
    assigneeId?: string
    parentId?: string
    typeId?: string
    createdAt?: number
  }>,
) {
  const id = crypto.randomUUID()
  const now = opts?.createdAt ?? currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO issues (id, workspace_id, project_id, number, title, body, status, status_id, priority,
       assignee_id, labels, parent_id, type_id, created_by_id, created_at, updated_at)
     SELECT ?, ?, ?, COALESCE(MAX(number), 0) + 1, ?, '', ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?
     FROM issues WHERE project_id = ?`,
  )
    .bind(
      id,
      workspaceId,
      projectId,
      opts?.title ?? 'Seeded issue',
      opts?.status ?? 'backlog',
      opts?.statusId ?? SQL_NULL,
      opts?.priority ?? 'none',
      opts?.assigneeId ?? SQL_NULL,
      opts?.parentId ?? SQL_NULL,
      opts?.typeId ?? SQL_NULL,
      createdById,
      now,
      now,
      projectId,
    )
    .run()
  await env.DB.prepare(
    `UPDATE issues SET status_category = COALESCE((SELECT category FROM task_statuses WHERE id = ?), '') WHERE id = ?`,
  )
    .bind(opts?.statusId ?? SQL_NULL, id)
    .run()
  const row = await env.DB.prepare('SELECT number FROM issues WHERE id = ?').bind(id).first<{ number: number }>()
  return { id, number: row!.number, createdAt: now }
}

export const seedCustomFieldDef = async function seedCustomFieldDef(
  workspaceId: string,
  opts: Readonly<{
    key: string
    label?: string
    type?: string
    options?: string[]
    projectId?: string | null
  }>,
) {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO custom_field_definitions (id, workspace_id, project_id, key, label, type, options, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      opts.projectId ?? SQL_NULL,
      opts.key,
      opts.label ?? opts.key,
      opts.type ?? 'text',
      opts.options ? JSON.stringify(opts.options) : SQL_NULL,
      now,
    )
    .run()
  return { id, key: opts.key }
}

export const seedCustomFieldValue = async function seedCustomFieldValue(
  issueId: string,
  fieldId: string,
  value: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO custom_field_values (issue_id, field_id, value) VALUES (?, ?, ?)
     ON CONFLICT(issue_id, field_id) DO UPDATE SET value = excluded.value`,
  )
    .bind(issueId, fieldId, value)
    .run()
}

/**
 * Seed an agent (or human) session plus an active issue lease directly, bypassing the
 * claim flow. `live: true` (default) means an active session heartbeating within the
 * TTL (a live lease); `live: false` means an ended session with a stale heartbeat (the
 * issue was agent-worked but no lease is currently live).
 *
 * @param {string} workspaceId - The ID of the workspace for the session and lease.
 * @param {string} issueId - The ID of the issue for the lease.
 * @param {Readonly<{ kind?: 'agent' | 'human'; live?: boolean; name?: string }>} opts - The session kind, session name, and lease state.
 * @returns {Promise<{ agentSessionId: string; leaseId: string }>} The IDs of the session and lease.
 */
export const seedAgentLease = async function seedAgentLease(
  workspaceId: string,
  issueId: string,
  opts?: Readonly<{ kind?: 'agent' | 'human'; live?: boolean; name?: string }>,
): Promise<{ agentSessionId: string; leaseId: string }> {
  const now = currentEpochSeconds()
  const live = opts?.live ?? true
  const agentSessionId = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO agent_sessions
       (id, workspace_id, issue_id, token_id, name, kind, status, started_at, last_heartbeat_at, ended_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      agentSessionId,
      workspaceId,
      issueId,
      opts?.name ?? 'seed-agent',
      opts?.kind ?? 'agent',
      live ? 'active' : 'ended',
      now,
      live ? now : now - 1000,
      live ? SQL_NULL : now,
    )
    .run()
  const leaseId = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO issue_leases (id, workspace_id, issue_id, agent_session_id, claimed_at, released_at, release_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(leaseId, workspaceId, issueId, agentSessionId, now, live ? SQL_NULL : now, live ? SQL_NULL : 'agent_ended')
    .run()
  return { agentSessionId, leaseId }
}

/**
 * Seed a complete workspace + user + member + token in one call
 *
 * @param {Readonly<{ slug?: string; email?: string; role?: string }>} opts - The workspace slug, user email address, and workspace role.
 * @returns {Promise<{ workspace: Awaited<ReturnType<typeof seedWorkspace>>; user: Awaited<ReturnType<typeof seedUser>>; token: string }>} The workspace, the user, and the raw token.
 */
export const seedFixture = async function seedFixture(
  opts?: Readonly<{ slug?: string; email?: string; role?: string }>,
) {
  const workspace = await seedWorkspace(opts?.slug ?? `ws-${crypto.randomUUID().slice(0, 8)}`)
  const user = await seedUser(opts?.email ?? `u-${crypto.randomUUID().slice(0, 8)}@example.com`)
  await seedMember(workspace.id, user.id, opts?.role ?? 'member')
  const token = await seedToken(workspace.id, user.id)
  return { workspace, user, token }
}

/**
 * Seed a workspace fixture plus a project in it — the common `beforeEach` shape across API tests.
 *
 * @param {Readonly<{ role?: string }>} opts - The workspace role for the user. The default role is `member`.
 * @returns {Promise<{ token: string; slug: string; workspaceId: string; userId: string; projectId: string }>} The raw token, workspace slug, and IDs for the workspace, user, and project.
 */
export const seedProjectFixture = async function seedProjectFixture(opts?: Readonly<{ role?: string }>) {
  const fixture = await seedFixture({ role: opts?.role })
  const project = await seedProject(fixture.workspace.id)
  /*
   * PROJ-311: access is default-deny, so a non-admin fixture would otherwise see
   * nothing. Grant the fixture user their workspace role on the project so the
   * pre-existing (pre-groups) behaviour is preserved for all these tests.
   */
  const role = opts?.role ?? 'member'
  if (role === 'member' || role === 'viewer') {
    await seedGroupGrant(fixture.workspace.id, fixture.user.id, project.id, role)
  }
  return {
    token: fixture.token,
    slug: fixture.workspace.slug,
    workspaceId: fixture.workspace.id,
    userId: fixture.user.id,
    projectId: project.id,
  }
}

/**
 * Seed a project fixture plus an issue in it.
 *
 * @param {Readonly<{ role?: string; issueTitle?: string }>} opts - The workspace role and issue title.
 * @returns {Promise<Awaited<ReturnType<typeof seedProjectFixture>> & { issueId: string }>} The project fixture with the issue ID.
 */
export const seedIssueFixture = async function seedIssueFixture(
  opts?: Readonly<{ role?: string; issueTitle?: string }>,
) {
  const base = await seedProjectFixture({ role: opts?.role })
  const issue = await seedIssue(base.workspaceId, base.projectId, base.userId, {
    title: opts?.issueTitle ?? 'Test Issue',
  })
  return { ...base, issueId: issue.id }
}

/**
 * Seed a single workspace with owner, member, and viewer principals — each with their own token.
 * Used by authorization tests that need to assert role-based 403s within the same workspace.
 *
 * Scaffolding note: when scopes are enforced at the middleware level, extend each seedToken call
 * here (or in individual tests) with the opts.scopes parameter to exercise restricted-scope paths.
 *
 * @returns {Promise<{ workspace: Awaited<ReturnType<typeof seedWorkspace>> } & Record<'owner' | 'member' | 'viewer', { user: Awaited<ReturnType<typeof seedUser>>; token: string }>>} The workspace and the user and raw token for each role.
 */
export const seedWorkspaceRoles = async function seedWorkspaceRoles() {
  const workspace = await seedWorkspace(`ws-${crypto.randomUUID().slice(0, 8)}`)

  const ownerUser = await seedUser(`owner-${crypto.randomUUID().slice(0, 8)}@example.com`)
  await seedMember(workspace.id, ownerUser.id, 'owner')
  const ownerToken = await seedToken(workspace.id, ownerUser.id)

  const memberUser = await seedUser(`member-${crypto.randomUUID().slice(0, 8)}@example.com`)
  await seedMember(workspace.id, memberUser.id, 'member')
  const memberToken = await seedToken(workspace.id, memberUser.id)

  const viewerUser = await seedUser(`viewer-${crypto.randomUUID().slice(0, 8)}@example.com`)
  await seedMember(workspace.id, viewerUser.id, 'viewer')
  const viewerToken = await seedToken(workspace.id, viewerUser.id)

  return {
    workspace,
    owner: { user: ownerUser, token: ownerToken },
    member: { user: memberUser, token: memberToken },
    viewer: { user: viewerUser, token: viewerToken },
  }
}

/*
 * PROJ-893: a failed tools/call is a *result* with `isError: true`, whose single text
 * content item is `{"error": {code, message, fields?, hint?, details?}}` — not a JSON-RPC
 * `error`. JSON-RPC errors remain only for protocol faults (parse error, invalid request,
 * method not found, unknown tool) and unexpected internal failures.
 */
export interface ToolErrorBody {
  code: 'not_found' | 'forbidden' | 'conflict' | 'validation' | 'payload_too_large' | 'rate_limited'
  message: string
  fields?: Record<string, string[]>
  hint?: string
  details?: Record<string, unknown>
}

/**
 * The `{error}` body of a failed tools/call, given the parsed JSON-RPC response, or
 * `undefined` when the call succeeded or failed as a JSON-RPC protocol error (check
 * `.error` on the response for that).
 *
 * @param {unknown} response - The parsed JSON-RPC response.
 * @returns {ToolErrorBody | undefined} The tool error or `undefined` if the response has no tool error text.
 */
export const toolError = function toolError(response: unknown): ToolErrorBody | undefined {
  const result = (response as { result?: { isError?: boolean; content?: { type: string; text: string }[] } })?.result
  if (result?.isError !== true) {
    return undefined
  }
  const text = result.content?.[0]?.text
  if (!Predicate.isString(text)) {
    return undefined
  }
  return (JSON.parse(text) as { error: ToolErrorBody }).error
}
