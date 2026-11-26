import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { Iterable, Predicate, Number } from 'effect'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { relyingPartyHost } from '#contracts/oauth-consent.ts'
import type { ConsentWorkspace } from '#contracts/oauth-consent.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { NotFoundError } from './errors.ts'

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
} from '#contracts/oauth-consent.ts'

/**
 * Missing workspaces and missing membership are indistinguishable to the consent screen.
 *
 * @param {D1Database} db Database that stores workspaces and memberships.
 * @param {string} userId User requesting consent.
 * @param {string} workspaceId Workspace selected for the grant.
 * @returns {Promise<ConsentWorkspace | null>} The workspace and member role, or null when either is missing.
 */
export const lookupConsentWorkspace = async function lookupConsentWorkspace(
  db: D1Database,
  userId: string,
  workspaceId: string,
): Promise<ConsentWorkspace | null> {
  const row = await db
    .prepare(`SELECT w.id, w.name, w.slug, m.role
    FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = ? WHERE w.id = ?`)
    .bind(userId, workspaceId)
    .first<{ id: string; name: string; slug: string; role: string | null }>()
  if (!isNonEmptyText(row?.role)) {
    return null
  }
  return fieldsInOrder([
    ['id', row.id],
    ['name', row.name],
    ['slug', row.slug],
    ['role', row.role],
  ])
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

/**
 * Grants are personal credentials, scoped to their consenting user and workspace. Bound the KV page walk.
 *
 * @param {OAuthHelpers} api OAuth provider helpers for listing grants.
 * @param {string} userId User who granted consent.
 * @param {string} workspaceId Workspace that the grants can access.
 * @returns {Promise<ConnectorGrant[]>} Redeemed grants from the scanned pages, newest first.
 */
export const listConnectorGrants = async function listConnectorGrants(
  api: OAuthHelpers,
  userId: string,
  workspaceId: string,
): Promise<ConnectorGrant[]> {
  const grants: ConnectorGrant[] = []
  let cursor: string | undefined
  for (let page = 0; page < GRANT_MAX_PAGES; page = Number.increment(page)) {
    const result = await api.listUserGrants(userId, { limit: GRANT_PAGE_SIZE, cursor })
    Iterable.forEach(result.items, (grant) => {
      if ((grant.metadata as { workspaceId?: string } | null)?.workspaceId !== workspaceId) {
        return
      }
      // An unredeemed authorization code is pending, not a live connector. Keep the provider's finite refresh TTL.
      if (Predicate.isNullish(grant.expiresAt)) {
        return
      }
      grants.push({
        id: grant.id,
        client: relyingPartyHost(grant.clientId),
        clientId: grant.clientId,
        scopes: grant.scope,
        grantedAt: grant.createdAt,
        expiresAt: grant.expiresAt,
      })
    })
    if (!isNonEmptyText(result.cursor)) {
      break
    }
    cursor = result.cursor
  }
  return grants.toSorted((left, right) => right.grantedAt - left.grantedAt)
}

/**
 * The provider enforces user ownership. This lookup additionally prevents cross-workspace revocation.
 *
 * @param {OAuthHelpers} api OAuth provider helpers for listing and revoking grants.
 * @param {string} userId User who granted consent.
 * @param {string} workspaceId Workspace in which the grant must be visible.
 * @param {string} grantId Provider identifier of the grant to revoke.
 * @returns {Promise<{ ok: true }>} An acknowledgment after the provider revokes the grant.
 */
export const revokeConnectorGrant = async function revokeConnectorGrant(
  api: OAuthHelpers,
  userId: string,
  workspaceId: string,
  grantId: string,
): Promise<{ ok: true }> {
  const grants = await listConnectorGrants(api, userId, workspaceId)
  if (!grants.some((grant) => grant.id === grantId)) {
    throw new NotFoundError('Connector not found')
  }
  await api.revokeGrant(grantId, userId)
  return { ok: true }
}
