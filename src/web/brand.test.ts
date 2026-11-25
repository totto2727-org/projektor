import { Iterable } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'
import { runTestEffect } from '#tests/run-effect.ts'

import { brandStyles, defaultBrand, deploymentBrand, loadBrand } from './brand.ts'
import type { RequestScope } from './server/server-context.ts'
import { testEnvironment } from './server/test/resources.ts'
import { createTestDatabase } from './test/database.ts'

const databases: ReturnType<typeof createTestDatabase>[] = []
const workspace = { id: 'w', slug: 'beta', name: 'Beta', role: 'owner' as const }
const request = new Request('https://front.example/?workspace=beta')
const scope: RequestScope = {
  user: { id: 'u', email: 'u@example.test', name: 'User' },
  workspaces: [workspace],
  projects: [],
  selection: { kind: 'workspace', workspace },
}
const fixture = function fixture() {
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
  database.sqlite.exec(
    "INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1); INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w','u','owner',1)",
  )
  return {
    database,
    env: testEnvironment(database.db, 'u@example.test', { BRAND_NAME: 'Deploy', BRAND_ACCENT: '#123456' }),
  }
}

describe('server-rendered native brand', () => {
  afterEach(() => {
    Iterable.forEach(databases.splice(0), (database) => {
      database.close()
    })
  })

  test('normalizes deployment bindings and derives a Unicode mark', () => {
    expect(deploymentBrand({})).toStrictEqual(defaultBrand)
    expect(
      deploymentBrand({
        BRAND_NAME: '  🐳 Team  ',
        BRAND_ACCENT: ' #123456 ',
        BRAND_ON_ACCENT: ' ',
        BRAND_LOGO_URL: ' /logo.svg ',
      }),
    ).toStrictEqual({ accent: '#123456', logoUrl: '/logo.svg', mark: '🐳', name: '🐳 Team', onAccent: JSON_NULL })
    expect(deploymentBrand({ BRAND_NAME: 'Deploy', BRAND_MARK: '  xyz ' }).mark).toBe('x')
  })

  test('layers only the explicitly resolved workspace over deployment bindings', async () => {
    const { env } = fixture()
    const brand = await runTestEffect(loadBrand(env, scope, request))
    expect(brand).toStrictEqual({
      accent: '#123456',
      logoUrl: '/api/workspaces/beta/brand/logo',
      mark: 'B',
      name: 'Beta',
      onAccent: '#ffffff',
    })
    expect(brandStyles(brand)).toStrictEqual({
      '--dark-accent': '#123456',
      '--dark-on-accent': '#ffffff',
      '--light-accent': '#123456',
      '--light-on-accent': '#ffffff',
    })
  })

  test('does not look up a tenant on global or public pages', async () => {
    const { env, database } = fixture()
    database.sqlite.exec('DROP TABLE workspaces')
    await expect(runTestEffect(loadBrand(env, null))).resolves.toStrictEqual(deploymentBrand(env))
    await expect(runTestEffect(loadBrand(env, { ...scope, selection: { kind: 'global' } }))).resolves.toStrictEqual(
      deploymentBrand(env),
    )
  })

  test('does not apply branding from unverified membership or mismatched workspace slug', async () => {
    const { env } = fixture()
    await expect(runTestEffect(loadBrand(env, { ...scope, workspaces: [] }))).resolves.toStrictEqual(
      deploymentBrand(env),
    )
    await expect(
      runTestEffect(loadBrand(env, { ...scope, workspaces: [{ ...workspace, slug: 'other' }] })),
    ).resolves.toStrictEqual(deploymentBrand(env))
  })

  test('keeps cosmetic database failures optional', async () => {
    const { env, database } = fixture()
    database.sqlite.exec('DROP TABLE workspaces')
    await expect(runTestEffect(loadBrand(env, scope, request))).resolves.toStrictEqual(deploymentBrand(env))
  })

  test('reads workspace branding afresh instead of sharing a cross-request cache', async () => {
    const { env, database } = fixture()
    const result = await runTestEffect(loadBrand(env, scope, request))
    expect(result.name).toBe('Beta')
    database.sqlite
      .prepare('UPDATE workspaces SET brand = ? WHERE id = ?')
      .run(JSON.stringify({ displayName: 'Changed' }), 'w')
    const resolvedValue = await runTestEffect(loadBrand(env, scope, request))
    expect(resolvedValue.name).toBe('Changed')
  })
})
