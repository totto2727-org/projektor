import type { OAuthProvider } from '@cloudflare/workers-oauth-provider'

export const OAUTH_PURGE_STATE_KEY = 'cron:oauth-purge:continuation:v1'
const PAGE_SIZE = 200
const KV_CALL_BUDGET = 800

type Phase = 'grants' | 'tokens'
interface Continuation {
  phase: Phase
  cursor?: string
}
type OAuthEnvironment = { OAUTH_KV: KVNamespace }
type PurgeProvider = Pick<OAuthProvider<OAuthEnvironment>, 'purgeExpiredData'>

function continuation(value: unknown): Continuation {
  if (value === null) return { phase: 'grants' }
  if (typeof value !== 'object') throw new Error('Invalid OAuth purge continuation')
  const phase: unknown = Reflect.get(value, 'phase')
  const cursor: unknown = Reflect.get(value, 'cursor')
  if ((phase !== 'grants' && phase !== 'tokens') || (cursor !== undefined && typeof cursor !== 'string')) {
    throw new Error('Invalid OAuth purge continuation')
  }
  return cursor ? { phase, cursor } : { phase }
}

/** Sweep one public KV page with the official provider's expiration and revocation logic.
 * The SDK sees a finite page view, while the real namespace cursor is committed only
 * after every item succeeds. Nested grant-token revocation keeps its real pagination.
 */
export async function purgeOAuthPage(env: OAuthEnvironment & { KV: KVNamespace }, provider: PurgeProvider) {
  const previous = continuation(await env.KV.get<unknown>(OAUTH_PURGE_STATE_KEY, 'json'))
  const prefix = previous.phase === 'grants' ? 'grant:' : 'token:'
  let scanned: { complete: boolean; cursor?: string } | undefined
  let calls = 0
  const spend = () => {
    if (++calls > KV_CALL_BUDGET) throw new Error('OAuth purge KV call budget exhausted')
  }
  const list = async <Metadata = unknown>(
    options?: KVNamespaceListOptions,
  ): Promise<KVNamespaceListResult<Metadata>> => {
    spend()
    if (options?.prefix !== prefix) return env.OAUTH_KV.list<Metadata>(options)
    if (scanned) throw new Error('OAuth purge attempted more than one scan page')
    const page = await env.OAUTH_KV.list<Metadata>({
      ...options,
      limit: PAGE_SIZE,
      ...(previous.cursor ? { cursor: previous.cursor } : {}),
    })
    scanned = page.list_complete ? { complete: true } : { complete: false, cursor: page.cursor }
    // This adapter exposes exactly the selected page, not the entire namespace.
    return { keys: page.keys, cacheStatus: page.cacheStatus, list_complete: true }
  }
  const oauth = new Proxy(env.OAUTH_KV, {
    get(target, key, receiver): unknown {
      if (key === 'list') return list
      const value: unknown = Reflect.get(target, key, receiver)
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        spend()
        return await Reflect.apply(value, target, args)
      }
    },
  })
  const result = await provider.purgeExpiredData(
    { OAUTH_KV: oauth },
    {
      batchSize: PAGE_SIZE,
      purgeExpiredGrants: previous.phase === 'grants',
      purgeOrphanedGrants: previous.phase === 'grants',
      purgeOrphanedTokens: previous.phase === 'tokens',
    },
  )
  if (!scanned) throw new Error('OAuth purge did not scan its selected page')
  if (!scanned.complete && !scanned.cursor) throw new Error('OAuth purge returned no continuation cursor')
  const next: Continuation = scanned.complete
    ? { phase: previous.phase === 'grants' ? 'tokens' : 'grants' }
    : { phase: previous.phase, cursor: scanned.cursor }
  await env.KV.put(OAUTH_PURGE_STATE_KEY, JSON.stringify(next))
  return {
    ...result,
    done: previous.phase === 'tokens' && scanned.complete,
    phase: previous.phase,
    nextPhase: next.phase,
    kvCalls: calls,
  }
}
