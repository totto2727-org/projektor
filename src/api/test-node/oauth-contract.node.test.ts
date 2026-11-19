import { describe, expect, it } from 'vite-plus/test'

import { OAUTH_SCOPES_SUPPORTED } from '../../contracts/auth-scopes'
import {
  grantedScopes,
  isLoopbackOnlyClient,
  OAuthRequestError,
  relyingPartyHost,
  workspaceIdFromResource,
} from '../../contracts/oauth-consent'

/** These are protocol contracts. Live provider/consent integration stays in oauth.test.ts. */
describe('neutral OAuth workspace audience and scope protocol', () => {
  it('requires exactly one MCP workspace audience', () => {
    for (const resource of [undefined, [], ['https://host/mcp/a', 'https://host/mcp/b'], 'https://host/api/issues']) {
      expect(() => workspaceIdFromResource(resource)).toThrow(OAuthRequestError)
    }
    expect(workspaceIdFromResource(['https://host/mcp/workspace-id'])).toBe('workspace-id')
  })
  it('rejects invalid URLs rather than granting a global audience', () => {
    expect(() => workspaceIdFromResource('not-a-url')).toThrow('`resource` is not a valid URL')
  })
  it('preserves default supported scopes without expanding unknown requests', () => {
    expect(grantedScopes([])).toEqual([...OAUTH_SCOPES_SUPPORTED])
    expect(grantedScopes(['projektor:read', 'openid', 'offline_access'])).toEqual(['projektor:read'])
    expect(() => grantedScopes(['openid'])).toThrow(OAuthRequestError)
  })
  it('uses relying party host rather than self-declared application metadata', () => {
    expect(relyingPartyHost('https://client.test/metadata')).toBe('client.test')
    expect(relyingPartyHost('registered-client')).toBe('registered-client')
  })
  it('warns only when every registered redirect URI is loopback', () => {
    expect(isLoopbackOnlyClient(['http://localhost:1234/callback', 'http://127.0.0.1:4321/callback'])).toBe(true)
    expect(isLoopbackOnlyClient(['http://localhost:1234/callback', 'https://client.test/callback'])).toBe(false)
    expect(isLoopbackOnlyClient([])).toBe(false)
  })
})
