import { Predicate } from 'effect'
import { assert, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import {
  ensureUserProvisioned,
  forgetProvisionedForTests,
  provisionPublicViewer,
  resetProvisioningCacheForTests,
} from '#commands/provisioning.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import type { Env } from '#types'

import { env } from './fixture-api.ts'
import { seedMember, seedUser, seedWorkspace } from './helpers.ts'

/*
 * PROJ-433: provisioning short-circuits on a cached marker, which is module state and
 * outlives an individual test. Clear it between cases, or a test asserting on
 * provisioning's writes could be reading the previous test's.
 */
beforeEach(resetProvisioningCacheForTests)

/* The ensureUserProvisioned helper reads its config from the Env it's handed, so each test builds an
 * Env by spreading the test bindings and overriding the provisioning vars. Unique slugs +
 * emails per test keep the shared D1 from leaking state across cases. */
const envWith = function envWith(overrides: Partial<Env>): Env {
  return { ...(env as unknown as Env), ...overrides }
}

const memberRole = async function memberRole(workspaceId: string, userId: string): Promise<null | string> {
  const row = await env.DB.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .bind(workspaceId, userId)
    .first<{ role: string }>()
  return row?.role ?? null
}

// Simulates a prior removeMember call without going through the HTTP route.
const tombstoneRemoval = async function tombstoneRemoval(workspaceId: string, userId: string): Promise<void> {
  await env.DB.prepare('INSERT INTO provisioning_removals (workspace_id, user_id, removed_at) VALUES (?, ?, ?)')
    .bind(workspaceId, userId, currentEpochSeconds())
    .run()
}

describe('login provisioning', () => {
  test('first admin login creates the default workspace and makes them owner', async () => {
    const slug = 'prov-admin-create'
    const admin = await seedUser('admin-create@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'admin-create@example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: 'viewer',
      }),
      admin,
    )

    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>()
    assert.isNotNull(ws)
    await expect(memberRole(ws.id, admin.id)).resolves.toBe('owner')
  })

  test('non-admin auto-joins an existing workspace as viewer', async () => {
    const slug = 'prov-viewer'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('viewer-join@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'someone-else@example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: 'viewer',
      }),
      user,
    )

    await expect(memberRole(ws.id, user.id)).resolves.toBe('viewer')
  })

  test('non-admin logging in before any workspace exists gets nothing (no workspace, no membership)', async () => {
    const slug = 'prov-not-yet'
    const user = await seedUser('early-bird@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'boss@example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: 'viewer',
      }),
      user,
    )

    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first()
    expect(ws).toBeNull()
  })

  test('covers AUTO_JOIN_ROLE=none leaves non-admins without a membership (invite-only)', async () => {
    const slug = 'prov-invite-only'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('no-autojoin@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'boss@example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: 'none',
      }),
      user,
    )

    await expect(memberRole(ws.id, user.id)).resolves.toBeNull()
  })

  test('covers PROJ-193: defaults to invite-only (no auto-join) when AUTO_JOIN_ROLE is unset', async () => {
    const slug = 'prov-default-invite-only'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('unset-autojoin@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'boss@example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: undefined,
      }),
      user,
    )

    await expect(memberRole(ws.id, user.id)).resolves.toBeNull()
  })

  test('promotes an existing lower-role member to owner when they are now an admin', async () => {
    const slug = 'prov-promote'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('promote-me@example.com')
    await seedMember(ws.id, user.id, 'viewer')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'promote-me@example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: 'viewer',
      }),
      user,
    )

    await expect(memberRole(ws.id, user.id)).resolves.toBe('owner')
  })

  test('confines a non-admin to the workspace mapped to their email domain (not the default)', async () => {
    const mappedWs = await seedWorkspace('prov-mapped')
    const defaultWs = await seedWorkspace('prov-default-1')
    const user = await seedUser('colleague@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'boss@example.com',
        DEFAULT_WORKSPACE_SLUG: 'prov-default-1',
        AUTO_JOIN_ROLE: 'viewer',
        WORKSPACE_DOMAIN_MAP: '{"example.com":{"slug":"prov-mapped","role":"member"}}',
      }),
      user,
    )

    await expect(memberRole(mappedWs.id, user.id)).resolves.toBe('member')
    // Confinement: they must NOT have been auto-joined to the default workspace.
    await expect(memberRole(defaultWs.id, user.id)).resolves.toBeNull()
  })

  test('an admin in a mapped domain owns default + mapped workspace (ADMIN_EMAILS beats confinement)', async () => {
    const mappedWs = await seedWorkspace('prov-mapped-2')
    const defaultWs = await seedWorkspace('prov-default-2')
    const admin = await seedUser('tajd@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'tajd@example.com',
        DEFAULT_WORKSPACE_SLUG: 'prov-default-2',
        AUTO_JOIN_ROLE: 'viewer',
        WORKSPACE_DOMAIN_MAP: '{"example.com":{"slug":"prov-mapped-2","role":"member"}}',
      }),
      admin,
    )

    // The domain rule never confines an admin; admins own every workspace, mapped or not.
    await expect(memberRole(defaultWs.id, admin.id)).resolves.toBe('owner')
    await expect(memberRole(mappedWs.id, admin.id)).resolves.toBe('owner')
  })

  test('an admin is made owner of every existing workspace on login, not just the default', async () => {
    const defaultWs = await seedWorkspace('prov-own-all-default')
    const wsA = await seedWorkspace('prov-own-all-a')
    const wsB = await seedWorkspace('prov-own-all-b')
    const admin = await seedUser('owns-everything@example.com')
    // Pre-existing low role in one of them must be promoted to owner, not left as-is.
    await seedMember(wsA.id, admin.id, 'viewer')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'owns-everything@example.com',
        DEFAULT_WORKSPACE_SLUG: 'prov-own-all-default',
        AUTO_JOIN_ROLE: 'viewer',
      }),
      admin,
    )

    await expect(memberRole(defaultWs.id, admin.id)).resolves.toBe('owner')
    await expect(memberRole(wsA.id, admin.id)).resolves.toBe('owner')
    await expect(memberRole(wsB.id, admin.id)).resolves.toBe('owner')
  })

  test('matches ADMIN_EMAILS case-insensitively', async () => {
    const slug = 'prov-case'
    const user = await seedUser('mixed-case@example.com')

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'Mixed-Case@Example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: 'viewer',
      }),
      user,
    )

    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>()
    assert.isNotNull(ws)
    await expect(memberRole(ws.id, user.id)).resolves.toBe('owner')
  })
})

/*
 * PROJ-436: removeMember tombstones the removal (provisioning_removals); provisioning must
 * respect it across all three re-add paths, without affecting workspaces the user wasn't
 * removed from.
 */
describe('covers PROJ-436: removal tombstone', () => {
  test('a tombstoned admin is not re-owned of that workspace, but still owns others', async () => {
    const removedFrom = await seedWorkspace('prov-436-admin-removed')
    const stillOwns = await seedWorkspace('prov-436-admin-other')
    const admin = await seedUser('removed-admin@example.com')
    await tombstoneRemoval(removedFrom.id, admin.id)

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'removed-admin@example.com',
        DEFAULT_WORKSPACE_SLUG: 'prov-436-admin-default-unused',
        AUTO_JOIN_ROLE: 'viewer',
      }),
      admin,
    )

    await expect(memberRole(removedFrom.id, admin.id)).resolves.toBeNull()
    await expect(memberRole(stillOwns.id, admin.id)).resolves.toBe('owner')
  })

  test('a tombstoned user is not auto-rejoined to the default workspace', async () => {
    const slug = 'prov-436-autojoin-removed'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('removed-viewer@example.com')
    await tombstoneRemoval(ws.id, user.id)

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'boss@example.com',
        DEFAULT_WORKSPACE_SLUG: slug,
        AUTO_JOIN_ROLE: 'viewer',
      }),
      user,
    )

    await expect(memberRole(ws.id, user.id)).resolves.toBeNull()
  })

  test("a tombstoned user is not re-mapped into their domain's workspace", async () => {
    const mappedWs = await seedWorkspace('prov-436-domain-removed')
    const user = await seedUser('removed-colleague@example.com')
    await tombstoneRemoval(mappedWs.id, user.id)

    await ensureUserProvisioned(
      envWith({
        ADMIN_EMAILS: 'boss@example.com',
        DEFAULT_WORKSPACE_SLUG: 'prov-436-domain-default-unused',
        AUTO_JOIN_ROLE: 'viewer',
        WORKSPACE_DOMAIN_MAP: '{"example.com":{"slug":"prov-436-domain-removed","role":"member"}}',
      }),
      user,
    )

    await expect(memberRole(mappedWs.id, user.id)).resolves.toBeNull()
  })
})

/*
 * PROJ-433: provisioning used to run in full on every authenticated request. It now runs
 * once per user per TTL. There's no query counter to assert against here, so these prove
 * the short-circuit the way it's actually observable: delete what provisioning wrote, call
 * again, and see whether it comes back.
 */
describe('covers PROJ-433: provisioning runs once per user, not per request', () => {
  const dropMembership = async function dropMembership(workspaceId: string, userId: string): Promise<void> {
    await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, userId)
      .run()
  }

  test('does not re-run for a user it has already provisioned', async () => {
    const slug = 'prov-cache-hit'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('cache-hit@example.com')
    const config = envWith({
      ADMIN_EMAILS: '',
      DEFAULT_WORKSPACE_SLUG: slug,
      AUTO_JOIN_ROLE: 'viewer',
    })

    await ensureUserProvisioned(config, user)
    await expect(memberRole(ws.id, user.id)).resolves.toBe('viewer')

    await dropMembership(ws.id, user.id)
    await ensureUserProvisioned(config, user)

    // Still gone: the second call short-circuited instead of re-writing the membership.
    await expect(memberRole(ws.id, user.id)).resolves.toBeNull()
  })

  test('re-runs once the marker is gone', async () => {
    const slug = 'prov-cache-expiry'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('cache-expiry@example.com')
    const config = envWith({
      ADMIN_EMAILS: '',
      DEFAULT_WORKSPACE_SLUG: slug,
      AUTO_JOIN_ROLE: 'viewer',
    })

    await ensureUserProvisioned(config, user)
    await dropMembership(ws.id, user.id)

    await forgetProvisionedForTests(config, user.id)
    await ensureUserProvisioned(config, user)

    await expect(memberRole(ws.id, user.id)).resolves.toBe('viewer')
  })

  test('re-runs safely when the provisioned-marker read fails, instead of throwing', async () => {
    const slug = 'prov-kv-read-fail'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('kv-read-fail@example.com')
    const config = envWith({
      ADMIN_EMAILS: '',
      DEFAULT_WORKSPACE_SLUG: slug,
      AUTO_JOIN_ROLE: 'viewer',
    })

    await ensureUserProvisioned(config, user)
    await dropMembership(ws.id, user.id)
    resetProvisioningCacheForTests()

    vi.spyOn(env.KV, 'get').mockRejectedValueOnce(new Error('KV read failed'))
    try {
      await ensureUserProvisioned(config, user)
    } finally {
      vi.restoreAllMocks()
    }

    await expect(memberRole(ws.id, user.id)).resolves.toBe('viewer')
  })

  // Yet — that user would then stay unprovisioned for the whole TTL after bootstrap.
  test('does not cache a run that bailed waiting for the default workspace', async () => {
    const slug = 'prov-cache-early-bird'
    const user = await seedUser('cache-early-bird@example.com')
    const config = envWith({
      ADMIN_EMAILS: '',
      DEFAULT_WORKSPACE_SLUG: slug,
      AUTO_JOIN_ROLE: 'viewer',
    })

    await ensureUserProvisioned(config, user)

    const ws = await seedWorkspace(slug)
    await ensureUserProvisioned(config, user)

    await expect(memberRole(ws.id, user.id)).resolves.toBe('viewer')
  })

  test('caches the public viewer too', async () => {
    const slug = 'prov-cache-public'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('cache-public@projektor.local')
    const config = envWith({ DEFAULT_WORKSPACE_SLUG: slug })

    await provisionPublicViewer(config, user)
    await dropMembership(ws.id, user.id)
    await provisionPublicViewer(config, user)

    await expect(memberRole(ws.id, user.id)).resolves.toBeNull()
  })
})

// PROJ-432/433: the point of this work was round trips, so count them. A Proxy over the
// D1 binding records every statement the code under test issues.
const countingDb = function countingDb(db: D1Database): {
  counts: { prepare: number; batch: number }
  proxy: D1Database
} {
  const counts = { prepare: 0, batch: 0 }
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        counts.prepare += 1
      } else if (prop === 'batch') {
        counts.batch += 1
      }
      const value = Reflect.get(target, prop, receiver)
      return Predicate.isFunction(value) ? value.bind(target) : value
    },
  })
  return { counts, proxy }
}

describe('covers PROJ-433: provisioning query count', () => {
  test('costs one query for an already-owning admin, regardless of workspace count', async () => {
    const admin = await seedUser('count-admin@example.com')
    const slug = 'prov-count-default'
    for (const workspaceSlug of [slug, 'prov-count-a', 'prov-count-b', 'prov-count-c']) {
      await seedWorkspace(workspaceSlug)
    }
    const config = envWith({
      ADMIN_EMAILS: 'count-admin@example.com',
      DEFAULT_WORKSPACE_SLUG: slug,
    })

    /*
     * An admin owns *every* workspace, and this suite's D1 is shared, so the first run
     * legitimately writes a membership for each one. Measure the steady state after that:
     * same admin, same workspaces, nothing left to do.
     */
    await ensureUserProvisioned(config, admin)
    await forgetProvisionedForTests(config, admin.id)

    const { counts, proxy } = countingDb(env.DB)
    await ensureUserProvisioned(envWith({ ...config, DB: proxy }), admin)

    /*
     * One joined read of every workspace plus this admin's role in each. Previously it
     * was a workspace-list read plus a membership SELECT per workspace — dozens here.
     */
    expect(counts.prepare).toBe(1)
  })

  test('costs nothing at all once the user is cached', async () => {
    const admin = await seedUser('count-admin-warm@example.com')
    const ws = await seedWorkspace('prov-count-warm')
    await seedMember(ws.id, admin.id, 'owner')
    const config = envWith({
      ADMIN_EMAILS: 'count-admin-warm@example.com',
      DEFAULT_WORKSPACE_SLUG: 'prov-count-warm',
    })

    await ensureUserProvisioned(config, admin)

    const { counts, proxy } = countingDb(env.DB)
    await ensureUserProvisioned(envWith({ ...config, DB: proxy }), admin)

    expect(counts.prepare).toBe(0)
  })
})

/*
 * PROJ-373: the anonymous public-viewer's workspace membership, provisioned by
 * middleware/auth.ts's PUBLIC_READ_ONLY path. HTTP-level behavior (auth fallback
 * order, 401 when off) is covered in auth.test.ts.
 */
describe('public viewer provisioning (PROJ-373)', () => {
  test('joins the default workspace as viewer', async () => {
    const slug = 'prov-public-viewer'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('public-viewer@projektor.local')

    await provisionPublicViewer(envWith({ DEFAULT_WORKSPACE_SLUG: slug }), user)

    await expect(memberRole(ws.id, user.id)).resolves.toBe('viewer')
  })

  test('is a no-op until the default workspace is bootstrapped', async () => {
    const user = await seedUser('public-viewer-early@projektor.local')

    await provisionPublicViewer(envWith({ DEFAULT_WORKSPACE_SLUG: 'prov-public-viewer-not-yet' }), user)

    const ws = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?')
      .bind('prov-public-viewer-not-yet')
      .first()
    expect(ws).toBeNull()
  })

  test('never promotes an existing membership above viewer (idempotent, not privilege-escalating)', async () => {
    const slug = 'prov-public-viewer-existing-owner'
    const ws = await seedWorkspace(slug)
    const user = await seedUser('public-viewer-owner@projektor.local')
    await seedMember(ws.id, user.id, 'owner')

    await provisionPublicViewer(envWith({ DEFAULT_WORKSPACE_SLUG: slug }), user)

    await expect(memberRole(ws.id, user.id)).resolves.toBe('owner')
  })
})
