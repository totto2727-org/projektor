import { getOAuthApi, type OAuthHelpers, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider'

import type { Env } from '#types'

import { OAUTH_SCOPES_SUPPORTED } from '../api/auth/scopes'

export const TOKEN_ENDPOINT = '/oauth/token'
export const AUTHORIZE_ENDPOINT = '/oauth/authorize'

/** API token routing and direct Web credential management use identical provider configuration. */
export function providerOptions<E extends Pick<Env, 'OAUTH_KV'>>(app: ExportedHandler<E>): OAuthProviderOptions<E> {
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

const UNUSED_HANDLER: ExportedHandler<Pick<Env, 'OAUTH_KV'>> = {
  fetch: () => new Response('Not found', { status: 404 }),
}

/** getOAuthApi needs only the OAuth KV binding. Its routing handlers are not executed here. */
export function oauthApi(env: Pick<Env, 'OAUTH_KV'>): OAuthHelpers {
  return getOAuthApi(providerOptions(UNUSED_HANDLER), env)
}
