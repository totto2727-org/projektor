import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { brandStyles, defaultBrand, deploymentBrand, loadBrand } from './brand'
import type { RequestScope } from './server'
import { testEnvironment } from './server/test/resources'
import { createTestDatabase } from './test/database'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
const workspace = { id: 'w', slug: 'beta', name: 'Beta', role: 'owner' as const }
const scope: RequestScope = {
  user: { id: 'u', email: 'u@example.test', name: 'User' },
  workspaces: [workspace],
  projects: [],
  selection: { kind: 'workspace', workspace },
}
function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite
    .prepare('INSERT INTO workspaces(id,name,slug,created_at,brand) VALUES(?,?,?,1,?)')
    .run(
      'w',
      'Beta',
      'beta',
      JSON.stringify({ displayName: 'Beta', onAccent: '#ffffff', logoR2Key: 'w/brand-logo/logo' }),
    )
  return {
    database,
    env: testEnvironment(database.db, 'u@example.test', { BRAND_NAME: 'Deploy', BRAND_ACCENT: '#123456' }),
  }
}

describe('server-rendered native brand', () => {
  it('normalizes deployment bindings and derives a Unicode mark', () => {
    expect(deploymentBrand({})).toEqual(defaultBrand)
    expect(
      deploymentBrand({
        BRAND_NAME: '  🐳 Team  ',
        BRAND_ACCENT: ' #123456 ',
        BRAND_ON_ACCENT: ' ',
        BRAND_LOGO_URL: ' /logo.svg ',
      }),
    ).toEqual({ name: '🐳 Team', mark: '🐳', accent: '#123456', onAccent: null, logoUrl: '/logo.svg' })
    expect(deploymentBrand({ BRAND_NAME: 'Deploy', BRAND_MARK: '  xyz ' }).mark).toBe('x')
  })

  it('layers only the explicitly resolved workspace over deployment bindings', async () => {
    const { env } = fixture()
    const brand = await Effect.runPromise(loadBrand(env, scope))
    expect(brand).toEqual({
      name: 'Beta',
      mark: 'B',
      accent: '#123456',
      onAccent: '#ffffff',
      logoUrl: '/api/workspaces/beta/brand/logo',
    })
    expect(brandStyles(brand)).toEqual({
      '--light-accent': '#123456',
      '--dark-accent': '#123456',
      '--light-on-accent': '#ffffff',
      '--dark-on-accent': '#ffffff',
    })
  })

  it('does not look up a tenant on global or public pages', async () => {
    const { env, database } = fixture()
    database.sqlite.exec('DROP TABLE workspaces')
    expect(await Effect.runPromise(loadBrand(env, null))).toEqual(deploymentBrand(env))
    expect(await Effect.runPromise(loadBrand(env, { ...scope, selection: { kind: 'global' } }))).toEqual(
      deploymentBrand(env),
    )
  })

  it('does not apply branding from unverified membership or mismatched workspace slug', async () => {
    const { env } = fixture()
    expect(await Effect.runPromise(loadBrand(env, { ...scope, workspaces: [] }))).toEqual(deploymentBrand(env))
    expect(
      await Effect.runPromise(loadBrand(env, { ...scope, workspaces: [{ ...workspace, slug: 'other' }] })),
    ).toEqual(deploymentBrand(env))
  })

  it('keeps cosmetic database failures optional', async () => {
    const { env, database } = fixture()
    database.sqlite.exec('DROP TABLE workspaces')
    expect(await Effect.runPromise(loadBrand(env, scope))).toEqual(deploymentBrand(env))
  })

  it('reads workspace branding afresh instead of sharing a cross-request cache', async () => {
    const { env, database } = fixture()
    expect((await Effect.runPromise(loadBrand(env, scope))).name).toBe('Beta')
    database.sqlite
      .prepare('UPDATE workspaces SET brand = ? WHERE id = ?')
      .run(JSON.stringify({ displayName: 'Changed' }), 'w')
    expect((await Effect.runPromise(loadBrand(env, scope))).name).toBe('Changed')
  })
})
