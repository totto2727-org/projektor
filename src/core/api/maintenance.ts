import { String, Array, Predicate, Schema } from 'effect'

import type { ServiceCtx } from '#commands/types.ts'
import { purgeExpiredWikiPages, WIKI_TRASH_RETENTION_SECONDS } from '#commands/wiki.ts'
import { SECONDS_PER_DAY, currentEpochSeconds } from '#contracts/time.ts'
import type { CoreEnvironment } from '#core/environment.ts'

import { purgeOAuthPage } from './oauth-purge.ts'

const FTS_DEDUPE_ONCE_KV_KEY = 'maint:fts-dedupe-0065'
const RETENTION_CHUNK_SIZE = 500
const RETENTION_MAX_CHUNKS_PER_CATEGORY = 20
const NO_ROWS_DELETED = 0
const RETENTION_CHUNKS_PER_STEP = 1
const DEFAULT_WIKI_NOTIFICATION_RETENTION_DAYS = 90
const DEFAULT_AGENT_SESSION_RETENTION_DAYS = 90
const DEFAULT_ACTIVITY_RETENTION_DAYS = 365
const WIKI_TRASH_PURGE_CURSOR_KV_KEY = 'cron:wiki-trash-purge:cursor'
const WIKI_TRASH_SUBREQUEST_BUDGET = 100
const WIKI_TRASH_MIN_BUDGET_TO_START_WORKSPACE = 45
const WikiTrashCursor = Schema.Struct({ workspaceIds: Schema.Array(Schema.Unknown) })

/**
 * Run Core maintenance with the existing budgets and continuation policy.
 *
 * @param {CoreEnvironment} env Core bindings used by the scheduled jobs.
 */
export const runMaintenance = async function runMaintenance(env: CoreEnvironment): Promise<void> {
  await Promise.all([
    purgeAllWorkspacesExpiredWikiPages(env),
    purgeExpiredOAuthData(env),
    purgeExpiredRetentionData(env),
    runFtsDedupeOnce(env),
  ])
}

export async function runFtsDedupeOnce(env: CoreEnvironment): Promise<void> {
  try {
    if (await env.KV.get(FTS_DEDUPE_ONCE_KV_KEY)) {
      return
    }
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

const retentionCutoff = function retentionCutoff(raw: string | undefined, defaultDays: number): number {
  const days = Predicate.isString(raw) && String.isNonEmpty(raw.trim()) ? Number(raw) : Number.NaN
  return currentEpochSeconds() - (Number.isFinite(days) && days > 0 ? days : defaultDays) * SECONDS_PER_DAY
}

type RetentionTarget = Readonly<{
  params: Readonly<unknown[]>
  table: string
  whereSql: string
}>

type RetentionProgress = Readonly<{ chunksRemaining: number; totalDeleted: number }>

const deleteExpiredInChunks = async function deleteExpiredInChunks(
  db: D1Database,
  target: RetentionTarget,
  progress: RetentionProgress = { chunksRemaining: RETENTION_MAX_CHUNKS_PER_CATEGORY, totalDeleted: NO_ROWS_DELETED },
): Promise<number> {
  const { params, table, whereSql } = target
  const result = await db
    .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${whereSql} LIMIT ?)`)
    .bind(...params, RETENTION_CHUNK_SIZE)
    .run()
  const changes = result.meta.changes ?? NO_ROWS_DELETED
  const totalDeleted = progress.totalDeleted + changes
  if (changes < RETENTION_CHUNK_SIZE || progress.chunksRemaining === RETENTION_CHUNKS_PER_STEP) {
    return totalDeleted
  }
  return deleteExpiredInChunks(db, target, {
    chunksRemaining: progress.chunksRemaining - RETENTION_CHUNKS_PER_STEP,
    totalDeleted,
  })
}

export async function purgeExpiredRetentionData(env: CoreEnvironment): Promise<void> {
  const counts: Record<string, number> = {}
  const failures: string[] = []
  const categories = [
    {
      name: 'wiki_notifications',
      table: 'wiki_notifications',
      whereSql: 'created_at < ?',
      params: [retentionCutoff(env.WIKI_NOTIFICATION_RETENTION_DAYS, DEFAULT_WIKI_NOTIFICATION_RETENTION_DAYS)],
    },
    {
      name: 'agent_sessions',
      table: 'agent_sessions',
      // Released leases remain indefinitely because historical flow metrics consume them.
      whereSql: `status = 'ended' AND ended_at IS NOT NULL AND ended_at < ?
        AND NOT EXISTS (SELECT 1 FROM issue_leases l WHERE l.agent_session_id = agent_sessions.id)`,
      params: [retentionCutoff(env.AGENT_SESSION_RETENTION_DAYS, DEFAULT_AGENT_SESSION_RETENTION_DAYS)],
    },
    {
      name: 'activity',
      table: 'activity',
      whereSql: 'created_at < ?',
      params: [retentionCutoff(env.ACTIVITY_RETENTION_DAYS, DEFAULT_ACTIVITY_RETENTION_DAYS)],
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
      counts[category.name] = await deleteExpiredInChunks(env.DB, category)
    } catch (error) {
      failures.push(category.name)
      console.error('scheduled retention purge failed', { category: category.name, error })
    }
  }
  console.log('scheduled retention purge complete', { deleted: counts, failed: failures })
}

export async function purgeExpiredOAuthData(env: CoreEnvironment): Promise<void> {
  try {
    const [{ OAuthProvider }, { providerOptions }] = await Promise.all([
      import('@cloudflare/workers-oauth-provider'),
      import('#contracts/oauth-provider.ts'),
    ])
    const oauthProvider = new OAuthProvider(
      providerOptions<Pick<CoreEnvironment, 'OAUTH_KV'>>({
        fetch: () => new Response('Not found', { status: 404 }),
      }),
    )
    const result = await purgeOAuthPage(env, oauthProvider)
    console.log('scheduled OAuth purge complete', {
      done: result.done,
      phase: result.phase,
      nextPhase: result.nextPhase,
      kvCalls: result.kvCalls,
      grantsPurged: result.grantsPurged,
      tokensPurged: result.tokensPurged,
    })
  } catch (error) {
    console.error('scheduled OAuth purge failed', { error })
  }
}

interface SubrequestBudget {
  spend: (count?: number) => void
  remaining: () => number
  used: () => number
}

const createSubrequestBudget = function createSubrequestBudget(limit: number): SubrequestBudget {
  let used = 0
  return {
    spend: (count = 1) => {
      used += count
    },
    remaining: () => limit - used,
    used: () => used,
  }
}

/**
 * Count database requests as they execute.
 *
 * @param {D1Database} db Native D1 binding used for the maintenance work.
 * @param {SubrequestBudget} budget Counter shared by the current purge run.
 * @returns {D1Database} A D1 wrapper that preserves native preparation, binding and execution.
 */
const wrapD1WithBudget = function wrapD1WithBudget(db: D1Database, budget: SubrequestBudget): D1Database {
  const reads = new Set(['all', 'first', 'raw', 'run'])
  return new Proxy(db, {
    get(target, property, receiver): unknown {
      if (property === 'prepare') {
        return (sql: string) => {
          const statement = Reflect.get(target, 'prepare', receiver).call(target, sql)
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver): unknown {
              if (statementProperty === 'bind') {
                return (...args: unknown[]) => {
                  const bound = Reflect.get(statementTarget, 'bind', statementReceiver).call(statementTarget, ...args)
                  return new Proxy(bound, {
                    get(boundTarget, boundProperty, boundReceiver) {
                      const original = Reflect.get(boundTarget, boundProperty, boundReceiver)
                      if (Predicate.isString(boundProperty) && reads.has(boundProperty)) {
                        return async (...values: unknown[]) => {
                          budget.spend()
                          return original.apply(boundTarget, values)
                        }
                      }
                      return Predicate.isFunction(original) ? original.bind(boundTarget) : original
                    },
                  })
                }
              }
              const original: unknown = Reflect.get(statementTarget, statementProperty, statementReceiver)
              return Predicate.isFunction(original) ? original.bind(statementTarget) : original
            },
          })
        }
      }
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          budget.spend()
          return Reflect.get(target, 'batch', receiver).call(target, statements)
        }
      }
      const original: unknown = Reflect.get(target, property, receiver)
      return Predicate.isFunction(original) ? original.bind(target) : original
    },
  })
}

const wrapCallsWithBudget = function wrapCallsWithBudget<T extends object>(target: T, budget: SubrequestBudget): T {
  return new Proxy(target, {
    get(object, property, receiver): unknown {
      const original: unknown = Reflect.get(object, property, receiver)
      if (!Predicate.isFunction(original)) {
        return original
      }
      return (...args: unknown[]): unknown => {
        budget.spend()
        return original.apply(object, args)
      }
    },
  })
}

const loadCursor = async function loadCursor(kv: KVNamespace): Promise<string[] | undefined> {
  const raw = await kv.get(WIKI_TRASH_PURGE_CURSOR_KV_KEY)
  if (Predicate.isNullish(raw) || String.isEmpty(raw)) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Schema.is(WikiTrashCursor)(parsed)) {
      return undefined
    }
    return parsed.workspaceIds.filter(Predicate.isString)
  } catch {
    return undefined
  }
}

export async function purgeAllWorkspacesExpiredWikiPages(env: CoreEnvironment): Promise<void> {
  const budget = createSubrequestBudget(WIKI_TRASH_SUBREQUEST_BUDGET)
  const kv = wrapCallsWithBudget(env.KV, budget)
  const cursor = await loadCursor(kv)
  const { results } = await wrapD1WithBudget(env.DB, budget)
    .prepare('SELECT DISTINCT workspace_id AS id FROM wiki_pages WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .bind(currentEpochSeconds() - WIKI_TRASH_RETENTION_SECONDS)
    .all<{ id: string }>()
  const remaining = [...new Set([...(cursor ?? []), ...(results ?? []).map((row) => row.id)])]
  let purged = 0
  let failed = 0
  const failedThisRun = new Set<string>()
  while (Array.isArrayNonEmpty(remaining) && budget.remaining() >= WIKI_TRASH_MIN_BUDGET_TO_START_WORKSPACE) {
    const [id] = remaining
    if (failedThisRun.has(id)) {
      if (remaining.every((workspace) => failedThisRun.has(workspace))) {
        break
      }
      remaining.shift()
      remaining.push(id)
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
      if (result.moreExpired) {
        remaining.shift()
        remaining.push(id)
      } else {
        remaining.shift()
      }
    } catch (error) {
      failed++
      failedThisRun.add(id)
      console.error('scheduled wiki trash purge failed for one workspace', { workspaceId: id, error })
      remaining.shift()
      remaining.push(id)
    }
    if (budget.used() === usedBefore) {
      break
    }
  }
  if (Array.isArrayEmpty(remaining)) {
    await kv.delete(WIKI_TRASH_PURGE_CURSOR_KV_KEY)
  } else {
    await kv.put(WIKI_TRASH_PURGE_CURSOR_KV_KEY, JSON.stringify({ workspaceIds: remaining }))
  }
  console.log('scheduled wiki trash purge complete', {
    purgedWorkspaces: purged,
    failedWorkspaces: failed,
    remainingWorkspaces: remaining.length,
    subrequestsUsed: budget.used(),
  })
}
