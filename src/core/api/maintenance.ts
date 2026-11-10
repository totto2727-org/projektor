import { OAuthProvider } from '@cloudflare/workers-oauth-provider'

import type { ServiceCtx } from '#commands/types'
import { purgeExpiredWikiPages, WIKI_TRASH_RETENTION_SECONDS } from '#commands/wiki'

import { providerOptions } from '../../contracts/oauth-provider'
import type { CoreEnvironment } from '../environment'

const FTS_DEDUPE_ONCE_KV_KEY = 'maint:fts-dedupe-0065'
const RETENTION_CHUNK_SIZE = 500
const RETENTION_MAX_CHUNKS_PER_CATEGORY = 20
const OAUTH_PURGE_BATCH_SIZE = 200
const WIKI_TRASH_PURGE_CURSOR_KV_KEY = 'cron:wiki-trash-purge:cursor'
const WIKI_TRASH_SUBREQUEST_BUDGET = 100
const WIKI_TRASH_MIN_BUDGET_TO_START_WORKSPACE = 45

/** Existing maintenance budgets and continuation policy, now executed inside Core. */
export async function runMaintenance(env: CoreEnvironment): Promise<void> {
  await Promise.all([
    purgeAllWorkspacesExpiredWikiPages(env),
    purgeExpiredOAuthData(env),
    purgeExpiredRetentionData(env),
    runFtsDedupeOnce(env),
  ])
}

export async function runFtsDedupeOnce(env: CoreEnvironment): Promise<void> {
  try {
    if (await env.KV.get(FTS_DEDUPE_ONCE_KV_KEY)) return
    await env.DB.prepare(`UPDATE OR IGNORE wiki_pages SET search_rowid = (
      SELECT MAX(rowid) FROM wiki_fts WHERE page_id = wiki_pages.id) WHERE search_rowid IS NULL`).run()
    const result = await env.DB.prepare(
      'DELETE FROM wiki_fts WHERE rowid NOT IN (SELECT search_rowid FROM wiki_pages WHERE search_rowid IS NOT NULL)',
    ).run()
    await env.KV.put(FTS_DEDUPE_ONCE_KV_KEY, '1')
    console.log('one-off wiki_fts dedupe complete (PROJ-816)', { deleted: result.meta.changes ?? 0 })
  } catch (error) {
    console.error('one-off wiki_fts dedupe failed (PROJ-816)', { error })
  }
}

function retentionCutoff(raw: string | undefined, defaultDays: number): number {
  const days = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN
  return Math.floor(Date.now() / 1000) - (Number.isFinite(days) && days > 0 ? days : defaultDays) * 86400
}

async function deleteExpiredInChunks(db: D1Database, table: string, whereSql: string, params: readonly unknown[]) {
  let totalDeleted = 0
  for (let index = 0; index < RETENTION_MAX_CHUNKS_PER_CATEGORY; index++) {
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${whereSql} LIMIT ?)`)
      .bind(...params, RETENTION_CHUNK_SIZE)
      .run()
    const changes = result.meta.changes ?? 0
    totalDeleted += changes
    if (changes < RETENTION_CHUNK_SIZE) break
  }
  return totalDeleted
}

export async function purgeExpiredRetentionData(env: CoreEnvironment): Promise<void> {
  const counts: Record<string, number> = {}
  const failures: string[] = []
  const categories = [
    {
      name: 'wiki_notifications',
      table: 'wiki_notifications',
      whereSql: 'created_at < ?',
      params: [retentionCutoff(env.WIKI_NOTIFICATION_RETENTION_DAYS, 90)],
    },
    {
      name: 'agent_sessions',
      table: 'agent_sessions',
      // Released leases remain indefinitely because historical flow metrics consume them.
      whereSql: `status = 'ended' AND ended_at IS NOT NULL AND ended_at < ?
        AND NOT EXISTS (SELECT 1 FROM issue_leases l WHERE l.agent_session_id = agent_sessions.id)`,
      params: [retentionCutoff(env.AGENT_SESSION_RETENTION_DAYS, 90)],
    },
    {
      name: 'activity',
      table: 'activity',
      whereSql: 'created_at < ?',
      params: [retentionCutoff(env.ACTIVITY_RETENTION_DAYS, 365)],
    },
  ]
  for (const category of categories) {
    try {
      if (category.table === 'agent_sessions') {
        const expiring = `SELECT id FROM agent_sessions WHERE ${category.whereSql}`
        await env.DB.batch(
          [
            `UPDATE agent_messages SET agent_id = NULL WHERE agent_id IN (${expiring})`,
            `UPDATE issue_file_claims SET agent_id = NULL WHERE agent_id IN (${expiring})`,
            `UPDATE claim_conflicts SET rejected_agent_id = NULL WHERE rejected_agent_id IN (${expiring})`,
            `UPDATE claim_conflicts SET holding_agent_id = NULL WHERE holding_agent_id IN (${expiring})`,
            `UPDATE wip_cap_denials SET agent_session_id = NULL WHERE agent_session_id IN (${expiring})`,
          ].map((sql) => env.DB.prepare(sql).bind(...category.params)),
        )
      }
      counts[category.name] = await deleteExpiredInChunks(env.DB, category.table, category.whereSql, category.params)
    } catch (error) {
      failures.push(category.name)
      console.error('scheduled retention purge failed', { category: category.name, error })
    }
  }
  console.log('scheduled retention purge complete', { deleted: counts, failed: failures })
}

const oauthProvider = new OAuthProvider(
  providerOptions<Pick<CoreEnvironment, 'OAUTH_KV'>>({
    fetch: () => new Response('Not found', { status: 404 }),
  }),
)

export async function purgeExpiredOAuthData(env: CoreEnvironment): Promise<void> {
  try {
    // One bounded call only. Repeating it would relist the same live grants.
    const result = await oauthProvider.purgeExpiredData(env, { batchSize: OAUTH_PURGE_BATCH_SIZE })
    console.log('scheduled OAuth purge complete', {
      done: result.done,
      grantsPurged: result.grantsPurged,
      tokensPurged: result.tokensPurged,
    })
  } catch (error) {
    console.error('scheduled OAuth purge failed', { error })
  }
}

function createSubrequestBudget(limit: number) {
  let used = 0
  return {
    spend: (count = 1) => {
      used += count
    },
    remaining: () => limit - used,
    used: () => used,
  }
}
type SubrequestBudget = ReturnType<typeof createSubrequestBudget>

/** Count real D1 calls without altering native prepare/bind/batch behavior. */
function wrapD1WithBudget(db: D1Database, budget: SubrequestBudget): D1Database {
  const reads = new Set(['all', 'first', 'raw', 'run'])
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'prepare')
        return (sql: string) => {
          const statement = Reflect.get(target, 'prepare', receiver).call(target, sql)
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === 'bind')
                return (...args: unknown[]) => {
                  const bound = Reflect.get(statementTarget, 'bind', statementReceiver).call(statementTarget, ...args)
                  return new Proxy(bound, {
                    get(boundTarget, boundProperty, boundReceiver) {
                      const original = Reflect.get(boundTarget, boundProperty, boundReceiver)
                      if (typeof boundProperty === 'string' && reads.has(boundProperty))
                        return async (...values: unknown[]) => {
                          budget.spend()
                          return original.apply(boundTarget, values)
                        }
                      return typeof original === 'function' ? original.bind(boundTarget) : original
                    },
                  })
                }
              const original = Reflect.get(statementTarget, statementProperty, statementReceiver)
              return typeof original === 'function' ? original.bind(statementTarget) : original
            },
          })
        }
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          budget.spend()
          return Reflect.get(target, 'batch', receiver).call(target, statements)
        }
      const original = Reflect.get(target, property, receiver)
      return typeof original === 'function' ? original.bind(target) : original
    },
  })
}

function wrapCallsWithBudget<T extends object>(target: T, budget: SubrequestBudget): T {
  return new Proxy(target, {
    get(object, property, receiver) {
      const original = Reflect.get(object, property, receiver)
      if (typeof original !== 'function') return original
      return (...args: unknown[]) => {
        budget.spend()
        return original.apply(object, args)
      }
    },
  })
}

async function loadCursor(kv: KVNamespace): Promise<string[] | null> {
  const raw = await kv.get(WIKI_TRASH_PURGE_CURSOR_KV_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !('workspaceIds' in parsed) || !Array.isArray(parsed.workspaceIds))
      return null
    return parsed.workspaceIds.filter((id): id is string => typeof id === 'string')
  } catch {
    return null
  }
}

export async function purgeAllWorkspacesExpiredWikiPages(env: CoreEnvironment): Promise<void> {
  const budget = createSubrequestBudget(WIKI_TRASH_SUBREQUEST_BUDGET)
  const kv = wrapCallsWithBudget(env.KV, budget)
  const cursor = await loadCursor(kv)
  const { results } = await wrapD1WithBudget(env.DB, budget)
    .prepare('SELECT DISTINCT workspace_id AS id FROM wiki_pages WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .bind(Math.floor(Date.now() / 1000) - WIKI_TRASH_RETENTION_SECONDS)
    .all<{ id: string }>()
  const remaining = [...new Set([...(cursor ?? []), ...(results ?? []).map((row) => row.id)])]
  let purged = 0
  let failed = 0
  const failedThisRun = new Set<string>()
  while (remaining.length > 0 && budget.remaining() >= WIKI_TRASH_MIN_BUDGET_TO_START_WORKSPACE) {
    const id = remaining[0]
    if (failedThisRun.has(id)) {
      if (remaining.every((workspace) => failedThisRun.has(workspace))) break
      remaining.push(remaining.shift()!)
      continue
    }
    const usedBefore = budget.used()
    const ctx: ServiceCtx = {
      db: wrapD1WithBudget(env.DB, budget),
      kv: env.KV,
      r2: wrapCallsWithBudget(env.R2, budget),
      workspaceId: id,
      userId: 'cron',
      role: 'owner',
    }
    try {
      const result = await purgeExpiredWikiPages(ctx)
      purged++
      if (result.moreExpired) remaining.push(remaining.shift()!)
      else remaining.shift()
    } catch (error) {
      failed++
      failedThisRun.add(id)
      console.error('scheduled wiki trash purge failed for one workspace', { workspaceId: id, error })
      remaining.push(remaining.shift()!)
    }
    if (budget.used() === usedBefore) break
  }
  if (remaining.length === 0) await kv.delete(WIKI_TRASH_PURGE_CURSOR_KV_KEY)
  else await kv.put(WIKI_TRASH_PURGE_CURSOR_KV_KEY, JSON.stringify({ workspaceIds: remaining }))
  console.log('scheduled wiki trash purge complete', {
    purgedWorkspaces: purged,
    failedWorkspaces: failed,
    remainingWorkspaces: remaining.length,
    subrequestsUsed: budget.used(),
  })
}
