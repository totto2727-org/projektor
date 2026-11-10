import { seedDefaultCustomFields } from '#commands/custom-fields'
import { seedDefaultTaskStatuses } from '#commands/task-statuses'
import { seedDefaultTaskTypes } from '#commands/task-types'
import { buildMcpAddCommand } from '#types'

import { coreFailure } from '../contract'
import type { CoreEnvironment } from '../environment'

/** Development provisioning stays private and rechecks its secret in Core. */
export async function bootstrapDevelopment(env: CoreEnvironment, provided: string | undefined, requestUrl: string) {
  if (env.ENVIRONMENT !== 'development') throw coreFailure(403, 'Not available in production')
  if (!env.BOOTSTRAP_SECRET) throw coreFailure(403, 'Not available')
  if (provided !== env.BOOTSTRAP_SECRET) throw coreFailure(403, 'Forbidden')
  const email = env.DEV_USER_EMAIL ?? 'admin@projektor.dev'
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(`INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name`)
    .bind(crypto.randomUUID(), email, email.split('@')[0], now)
    .run()
  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; name: string }>()
  await env.DB.prepare(`INSERT INTO workspaces (id, name, slug, created_at) VALUES (?, 'projektor', 'projektor', ?)
    ON CONFLICT(slug) DO NOTHING`)
    .bind(crypto.randomUUID(), now)
    .run()
  const workspace = await env.DB.prepare('SELECT id, name, slug FROM workspaces WHERE slug = ?')
    .bind('projektor')
    .first<{ id: string; name: string; slug: string }>()
  if (!user || !workspace) throw coreFailure(500, 'Development bootstrap failed')
  await env.DB.prepare(`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
    VALUES (?, ?, 'owner', ?) ON CONFLICT(workspace_id, user_id) DO NOTHING`)
    .bind(workspace.id, user.id, now)
    .run()
  await seedDefaultTaskTypes(env.DB, workspace.id)
  await seedDefaultTaskStatuses(env.DB, workspace.id)
  await seedDefaultCustomFields(env.DB, workspace.id)
  const token =
    'pk_' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare(`INSERT INTO api_tokens (id, workspace_id, user_id, name, token_hash, scopes, created_at)
    VALUES (?, ?, ?, 'bootstrap', ?, '["read","write"]', ?)`)
    .bind(crypto.randomUUID(), workspace.id, user.id, hash, now)
    .run()
  const mcpUrl = `${new URL(requestUrl).origin}/mcp/${workspace.id}`
  return {
    workspace,
    user,
    token,
    mcpUrl,
    mcpAddCommand: buildMcpAddCommand({ workspaceSlug: workspace.slug, mcpUrl, token }),
  }
}
