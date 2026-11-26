import { Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { OAUTH_SCOPES_SUPPORTED } from '#contracts/auth-scopes.ts'
import {
  grantedScopes,
  isLoopbackOnlyClient,
  OAuthRequestError,
  relyingPartyHost,
  workspaceIdFromResource,
} from '#contracts/oauth-consent.ts'

/** These are protocol contracts. Live provider/consent integration stays in oauth.test.ts. */
describe('neutral OAuth workspace audience and scope protocol', () => {
  test('requires exactly one MCP workspace audience', () => {
    expect.assertions(5)
    Iterable.forEach(
      [undefined, [], ['https://host/mcp/a', 'https://host/mcp/b'], 'https://host/api/issues'],
      (resource) => {
        expect(() => workspaceIdFromResource(resource)).toThrow(OAuthRequestError)
      },
    )
    expect(workspaceIdFromResource(['https://host/mcp/workspace-id'])).toBe('workspace-id')
  })

  test('rejects invalid URLs rather than granting a global audience', () => {
    expect(() => workspaceIdFromResource('not-a-url')).toThrow('`resource` is not a valid URL')
  })

  test('preserves default supported scopes without expanding unknown requests', () => {
    expect(grantedScopes([])).toStrictEqual([...OAUTH_SCOPES_SUPPORTED])
    expect(grantedScopes(['projektor:read', 'openid', 'offline_access'])).toStrictEqual(['projektor:read'])
    expect(() => grantedScopes(['openid'])).toThrow(OAuthRequestError)
  })

  test('uses relying party host rather than self-declared application metadata', () => {
    expect(relyingPartyHost('https://client.test/metadata')).toBe('client.test')
    expect(relyingPartyHost('registered-client')).toBe('registered-client')
  })

  test('warns only when every registered redirect URI is loopback', () => {
    expect(isLoopbackOnlyClient(['http://localhost:1234/callback', 'http://127.0.0.1:4321/callback'])).toBe(true)
    expect(isLoopbackOnlyClient(['http://localhost:1234/callback', 'https://client.test/callback'])).toBe(false)
    expect(isLoopbackOnlyClient([])).toBe(false)
  })
})
