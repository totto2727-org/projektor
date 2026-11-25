import type { AuthRequest } from '@cloudflare/workers-oauth-provider'
import { String, Array, Predicate } from 'effect'

import { hasSingleItem } from '#contracts/item-count.ts'

import { OAUTH_SCOPE_READ, OAUTH_SCOPE_WRITE, OAUTH_SCOPES_SUPPORTED } from './auth-scopes.ts'

/** Provider mechanics validate clients, redirect URIs and PKCE. This contract binds the workspace audience. */
export class OAuthRequestError extends Error {
  public readonly code: 'invalid_target' | 'invalid_scope'
  public readonly reason: string
  public constructor(code: 'invalid_target' | 'invalid_scope', reason: string) {
    super(reason)
    this.code = code
    this.reason = reason
    this.name = 'OAuthRequestError'
  }
}

export const workspaceIdFromResource = function workspaceIdFromResource(
  resource: string | string[] | undefined,
): string {
  if (Predicate.isNullish(resource)) {
    throw new OAuthRequestError('invalid_target', 'A `resource` parameter naming the target workspace is required')
  }
  if (globalThis.Array.isArray(resource)) {
    if (!hasSingleItem(resource)) {
      throw new OAuthRequestError('invalid_target', 'Exactly one `resource` may be requested')
    }
    return workspaceIdFromResource(resource[0])
  }
  let url: URL
  try {
    url = new URL(resource)
  } catch {
    throw new OAuthRequestError('invalid_target', '`resource` is not a valid URL')
  }
  const workspaceId = /^\/mcp\/([^/]+)$/.exec(url.pathname)?.[1]
  if (Predicate.isNullish(workspaceId) || String.isEmpty(workspaceId)) {
    throw new OAuthRequestError('invalid_target', '`resource` must name an MCP endpoint, e.g. https://host/mcp/<id>')
  }
  return decodeURIComponent(workspaceId)
}

/**
 * Use all supported scopes when the request omits the scope list. Discard unsupported scopes from an explicit list.
 *
 * @param {Readonly<string[]>} requested The scopes supplied by the OAuth client.
 * @returns {string[]} The granted scopes in provider order.
 */
export const grantedScopes = function grantedScopes(requested: Readonly<string[]>): string[] {
  if (Array.isReadonlyArrayEmpty(requested)) {
    return [...OAUTH_SCOPES_SUPPORTED]
  }
  const granted = OAUTH_SCOPES_SUPPORTED.filter((scope) => requested.includes(scope))
  if (Array.isArrayEmpty(granted)) {
    throw new OAuthRequestError(
      'invalid_scope',
      `No supported scopes requested. Supported: ${OAUTH_SCOPES_SUPPORTED.join(', ')}`,
    )
  }
  return [...granted]
}
export const describeScope = function describeScope(scope: string): string {
  if (scope === OAUTH_SCOPE_READ) {
    return 'Read issues, wiki pages, projects and comments'
  }
  if (scope === OAUTH_SCOPE_WRITE) {
    return 'Create and change issues, wiki pages, projects and comments'
  }
  return scope
}
/**
 * Derive the relying party identity from the client identifier.
 *
 * @param {string} clientId The registered OAuth client identifier.
 * @returns {string} The host including a port when present, or the raw identifier for clients with opaque IDs.
 */
export const relyingPartyHost = function relyingPartyHost(clientId: string): string {
  try {
    return new URL(clientId).host
  } catch {
    return clientId
  }
}
export const isLoopbackOnlyClient = function isLoopbackOnlyClient(redirectUris: Readonly<string[]>): boolean {
  if (Array.isReadonlyArrayEmpty(redirectUris)) {
    return false
  }
  return redirectUris.every((uri) => {
    try {
      const { hostname } = new URL(uri)
      return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.')
    } catch {
      return false
    }
  })
}
export type ConsentRequest = Readonly<{ authRequest: AuthRequest; workspaceId: string; scopes: string[] }>
export const parseConsentRequest = function parseConsentRequest(authRequest: AuthRequest): ConsentRequest {
  return {
    authRequest,
    workspaceId: workspaceIdFromResource(authRequest.resource),
    scopes: grantedScopes(authRequest.scope),
  }
}
export type ConsentWorkspace = Readonly<{ id: string; name: string; slug: string; role: string }>
