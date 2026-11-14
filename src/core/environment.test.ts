import { describe, expect, it } from 'vite-plus/test'

import { isCoreEnvironment } from './environment'

function fixture() {
  const binding = (methods: readonly string[]) => Object.fromEntries(methods.map((key) => [key, () => undefined]))
  return {
    DB: binding(['prepare', 'batch', 'exec', 'withSession', 'dump']),
    KV: binding(['get', 'put', 'delete', 'list', 'getWithMetadata']),
    OAUTH_KV: binding(['get', 'put', 'delete', 'list', 'getWithMetadata']),
    R2: binding(['get', 'head', 'put', 'delete', 'list', 'createMultipartUpload', 'resumeMultipartUpload']),
    ENVIRONMENT: 'production',
    CF_ACCESS_TEAM_DOMAIN: 'team.example',
    CF_ACCESS_AUDIENCE: 'audience',
  }
}

describe('Core native environment admission', () => {
  it('admits only concrete storage capabilities and scalar configuration', () => {
    expect(isCoreEnvironment(fixture())).toBe(true)
    expect(isCoreEnvironment({ ...fixture(), invocation: { waitUntil: () => undefined } })).toBe(true)
    expect(isCoreEnvironment({ ...fixture(), DB: {} })).toBe(false)
    expect(isCoreEnvironment({ ...fixture(), R2: { get: () => undefined } })).toBe(false)
    expect(isCoreEnvironment({ ...fixture(), KV: null })).toBe(false)
    expect(isCoreEnvironment({ ...fixture(), ENVIRONMENT: 'invalid' })).toBe(false)
    expect(isCoreEnvironment({ ...fixture(), STORAGE_QUOTA_BYTES: 10 })).toBe(false)
    expect(isCoreEnvironment({ ...fixture(), invocation: { waitUntil: 'not callable' } })).toBe(false)
    expect(isCoreEnvironment({ ...fixture(), WORKSPACE_HUB: {} })).toBe(false)
    expect(isCoreEnvironment(null)).toBe(false)
  })
})
