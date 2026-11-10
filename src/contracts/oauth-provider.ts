import { getOAuthApi, type OAuthHelpers, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider'

import { OAUTH_SCOPES_SUPPORTED } from './auth-scopes'

export const TOKEN_ENDPOINT = '/oauth/token'
export const AUTHORIZE_ENDPOINT = '/oauth/authorize'
export interface OAuthEnvironment {
  OAUTH_KV: KVNamespace
}

/** Shared provider protocol configuration contains no application storage or authority. */
export function providerOptions<E extends OAuthEnvironment>(app: ExportedHandler<E>): OAuthProviderOptions<E> {
  return {
    apiRoute: '/mcp/',
    apiHandler: app as OAuthProviderOptions<E>['apiHandler'],
    defaultHandler: app,
    authorizeEndpoint: AUTHORIZE_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...OAUTH_SCOPES_SUPPORTED],
  }
}

const UNUSED_HANDLER: ExportedHandler<OAuthEnvironment> = { fetch: () => new Response('Not found', { status: 404 }) }

/** Credential lifecycle is delegated to the official provider and its dedicated KV. */
export function oauthApi(env: OAuthEnvironment): OAuthHelpers {
  return getOAuthApi(providerOptions(UNUSED_HANDLER), env)
}
