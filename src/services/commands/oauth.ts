import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

import { relyingPartyHost, type ConsentWorkspace } from '../../contracts/oauth-consent'
import { NotFoundError } from './errors'

export {
  describeScope,
  grantedScopes,
  isLoopbackOnlyClient,
  OAuthRequestError,
  parseConsentRequest,
  relyingPartyHost,
  workspaceIdFromResource,
  type ConsentRequest,
  type ConsentWorkspace,
} from '../../contracts/oauth-consent'

/** Missing workspaces and missing membership are indistinguishable to the consent screen. */
export async function lookupConsentWorkspace(
  db: D1Database,
  userId: string,
  workspaceId: string,
): Promise<ConsentWorkspace | null> {
  const row = await db
    .prepare(`SELECT w.id, w.name, w.slug, m.role
    FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.id = ?`)
    .bind(userId, workspaceId)
    .first<{ id: string; name: string; slug: string; role: string | null }>()
  if (!row?.role) return null
  return { id: row.id, name: row.name, slug: row.slug, role: row.role }
}

export type ConnectorGrant = Readonly<{
  id: string
  client: string
  clientId: string
  scopes: string[]
  grantedAt: number
  expiresAt: number
}>
const GRANT_PAGE_SIZE = 100
const GRANT_MAX_PAGES = 5

/** Grants are personal credentials, scoped to their consenting user and workspace. Bound the KV page walk. */
export async function listConnectorGrants(
  api: OAuthHelpers,
  userId: string,
  workspaceId: string,
): Promise<ConnectorGrant[]> {
  const grants: ConnectorGrant[] = []
  let cursor: string | undefined
  for (let page = 0; page < GRANT_MAX_PAGES; page++) {
    const result = await api.listUserGrants(userId, { limit: GRANT_PAGE_SIZE, cursor })
    for (const grant of result.items) {
      if ((grant.metadata as { workspaceId?: string } | null)?.workspaceId !== workspaceId) continue
      // An unredeemed authorization code is pending, not a live connector. Keep the provider's finite refresh TTL.
      if (grant.expiresAt === undefined) continue
      grants.push({
        id: grant.id,
        client: relyingPartyHost(grant.clientId),
        clientId: grant.clientId,
        scopes: grant.scope,
        grantedAt: grant.createdAt,
        expiresAt: grant.expiresAt,
      })
    }
    if (!result.cursor) break
    cursor = result.cursor
  }
  return grants.sort((a, b) => b.grantedAt - a.grantedAt)
}

/** The provider enforces user ownership. This lookup additionally prevents cross-workspace revocation. */
export async function revokeConnectorGrant(
  api: OAuthHelpers,
  userId: string,
  workspaceId: string,
  grantId: string,
): Promise<{ ok: true }> {
  const grants = await listConnectorGrants(api, userId, workspaceId)
  if (!grants.some((grant) => grant.id === grantId)) throw new NotFoundError('Connector not found')
  await api.revokeGrant(grantId, userId)
  return { ok: true }
}
