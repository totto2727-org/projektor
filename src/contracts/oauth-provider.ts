import { getOAuthApi } from '@cloudflare/workers-oauth-provider'
import type {
  ClientRegistrationCallbackOptions,
  OAuthHelpers,
  OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider'
// TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
import { Predicate } from 'effect'

import { OAUTH_SCOPES_SUPPORTED } from './auth-scopes.ts'

export const TOKEN_ENDPOINT = '/oauth/token'
export const AUTHORIZE_ENDPOINT = '/oauth/authorize'
// TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
export const REGISTRATION_ENDPOINT = '/oauth/register'
export interface OAuthEnvironment {
  OAUTH_KV: KVNamespace
}

// TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
const validateNativeClient = function validateNativeClient({
  clientMetadata,
}: ClientRegistrationCallbackOptions): { description: string } | undefined {
  const redirects = clientMetadata.redirect_uris
  const redirect = Array.isArray(redirects) && redirects.length === 1 ? redirects[0] : undefined
  if (clientMetadata.token_endpoint_auth_method === 'none' && Predicate.isString(redirect) && URL.canParse(redirect)) {
    const url = new URL(redirect)
    if (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === '[::1]') &&
      !url.username &&
      !url.password &&
      !redirect.includes('#')
    ) {
      return
    }
  }
  return { description: 'Dynamic registration requires a public client with one HTTP loopback IP redirect URI.' }
}

/** Shared provider protocol configuration contains no application storage or authority. */
export const providerOptions = function providerOptions<E extends OAuthEnvironment>(
  app: ExportedHandler<E>,
): OAuthProviderOptions<E> {
  return {
    apiRoute: '/mcp/',
    apiHandler: app as OAuthProviderOptions<E>['apiHandler'],
    defaultHandler: app,
    authorizeEndpoint: AUTHORIZE_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
    clientRegistrationEndpoint: REGISTRATION_ENDPOINT,
    clientRegistrationCallback: validateNativeClient,
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...OAUTH_SCOPES_SUPPORTED],
  }
}

const UNUSED_HANDLER: ExportedHandler<OAuthEnvironment> = { fetch: () => new Response('Not found', { status: 404 }) }

/** Credential lifecycle is delegated to the official provider and its dedicated KV. */
export const oauthApi = function oauthApi(env: OAuthEnvironment): OAuthHelpers {
  return getOAuthApi(providerOptions(UNUSED_HANDLER), env)
}
