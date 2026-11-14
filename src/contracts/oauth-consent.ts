import type { AuthRequest } from '@cloudflare/workers-oauth-provider'

import { OAUTH_SCOPE_READ, OAUTH_SCOPE_WRITE, OAUTH_SCOPES_SUPPORTED } from './auth-scopes'

/** Provider mechanics validate clients, redirect URIs and PKCE. This contract binds the workspace audience. */
export class OAuthRequestError extends Error {
  readonly code: 'invalid_target' | 'invalid_scope'
  readonly reason: string
  constructor(code: 'invalid_target' | 'invalid_scope', reason: string) {
    super(reason)
    this.code = code
    this.reason = reason
    this.name = 'OAuthRequestError'
  }
}

export function workspaceIdFromResource(resource: string | string[] | undefined): string {
  if (resource === undefined)
    throw new OAuthRequestError('invalid_target', 'A `resource` parameter naming the target workspace is required')
  if (Array.isArray(resource)) {
    if (resource.length !== 1) throw new OAuthRequestError('invalid_target', 'Exactly one `resource` may be requested')
    return workspaceIdFromResource(resource[0])
  }
  let url: URL
  try {
    url = new URL(resource)
  } catch {
    throw new OAuthRequestError('invalid_target', '`resource` is not a valid URL')
  }
  const workspaceId = /^\/mcp\/([^/]+)$/.exec(url.pathname)?.[1]
  if (!workspaceId)
    throw new OAuthRequestError('invalid_target', '`resource` must name an MCP endpoint, e.g. https://host/mcp/<id>')
  return decodeURIComponent(workspaceId)
}

/** An omitted scope requests all supported scopes. Unsupported extras are discarded. */
export function grantedScopes(requested: readonly string[]): string[] {
  if (requested.length === 0) return [...OAUTH_SCOPES_SUPPORTED]
  const granted = OAUTH_SCOPES_SUPPORTED.filter((scope) => requested.includes(scope))
  if (granted.length === 0)
    throw new OAuthRequestError(
      'invalid_scope',
      `No supported scopes requested. Supported: ${OAUTH_SCOPES_SUPPORTED.join(', ')}`,
    )
  return [...granted]
}
export function describeScope(scope: string): string {
  if (scope === OAUTH_SCOPE_READ) return 'Read issues, wiki pages, projects and comments'
  if (scope === OAUTH_SCOPE_WRITE) return 'Create and change issues, wiki pages, projects and comments'
  return scope
}
/** The host, not the self-declared application name, is the relying party identity. */
export function relyingPartyHost(clientId: string): string {
  try {
    return new URL(clientId).host
  } catch {
    return clientId
  }
}
export function isLoopbackOnlyClient(redirectUris: readonly string[]): boolean {
  if (redirectUris.length === 0) return false
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
export function parseConsentRequest(authRequest: AuthRequest): ConsentRequest {
  return {
    authRequest,
    workspaceId: workspaceIdFromResource(authRequest.resource),
    scopes: grantedScopes(authRequest.scope),
  }
}
export type ConsentWorkspace = Readonly<{ id: string; name: string; slug: string; role: string }>
