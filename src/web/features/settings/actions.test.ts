import { describe, expect, test, vi } from 'vite-plus/test'

import { SQL_NULL } from '#db/sql-null.ts'
import { JSON_NULL } from '#tests/json-null.ts'
import { runInOrder } from '#tests/run-effect.ts'
import { actionFixture, formData } from '@/features/planning/action-test-fixture.ts'

// Only the Node host entrypoint is substituted. Real OAuth helpers and KV operations execute.
vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }))

const actions = await import('./actions.ts')
type Fixture = ReturnType<typeof actionFixture>
const workspace = { workspaceSlug: 'alpha' }
const group = { ...workspace, groupId: 'g1' }
function checkGrant(testFixture: Fixture): void {
  expect(
    testFixture.sqlite.prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'").get()
      ?.role,
  ).toBe('admin')
}
const cases: {
  label: string
  invoke: (test: Fixture) => Promise<unknown>
  check: (test: Fixture) => void | Promise<void>
}[] = [
  {
    label: 'create group',
    invoke: (testFixture) =>
      testFixture.invoke(actions.createGroup, JSON_NULL, formData({ ...workspace, name: ' New team ' })),
    check: (testFixture) => {
      expect(testFixture.sqlite.prepare("SELECT name FROM user_groups WHERE name='New team'").get()?.name).toBe(
        'New team',
      )
    },
  },
  {
    label: 'rename group',
    invoke: (testFixture) =>
      testFixture.invoke(actions.renameGroup, JSON_NULL, formData({ ...group, name: ' Renamed ' })),
    check: (testFixture) => {
      expect(testFixture.sqlite.prepare("SELECT name FROM user_groups WHERE id='g1'").get()?.name).toBe('Renamed')
    },
  },
  {
    label: 'save description',
    invoke: (testFixture) =>
      testFixture.invoke(actions.describeGroup, JSON_NULL, formData({ ...group, description: ' ' })),
    check: (testFixture) => {
      expect(
        testFixture.sqlite.prepare("SELECT description FROM user_groups WHERE id='g1'").get()?.description,
      ).toBeNull()
    },
  },
  {
    label: 'delete group',
    invoke: (testFixture) => testFixture.invoke(actions.deleteGroup, group),
    check: (testFixture) => {
      expect(testFixture.sqlite.prepare("SELECT id FROM user_groups WHERE id='g1'").get()).toBeUndefined()
      expect(
        testFixture.sqlite.prepare("SELECT group_id FROM user_group_members WHERE group_id='g1'").all(),
      ).toStrictEqual([])
    },
  },
  {
    label: 'add member',
    invoke: (testFixture) =>
      testFixture.invoke(actions.addGroupMember, JSON_NULL, formData({ ...group, userId: 'u1' })),
    check: (testFixture) => {
      expect(
        testFixture.sqlite.prepare("SELECT user_id FROM user_group_members WHERE group_id='g1' AND user_id='u1'").get()
          ?.user_id,
      ).toBe('u1')
    },
  },
  {
    label: 'remove member',
    invoke: (testFixture) => testFixture.invoke(actions.removeGroupMember, { ...group, userId: 'u2' }),
    check: (testFixture) => {
      expect(
        testFixture.sqlite.prepare("SELECT user_id FROM user_group_members WHERE group_id='g1' AND user_id='u2'").get(),
      ).toBeUndefined()
    },
  },
  {
    label: 'create/update grant',
    invoke: (testFixture) => testFixture.invoke(actions.setGroupGrant, { ...group, projectId: 'p1', role: 'admin' }),
    check: checkGrant,
  },
  {
    label: 'native create grant',
    invoke: (testFixture) =>
      testFixture.invoke(actions.createGroupGrant, JSON_NULL, formData({ ...group, projectId: 'p1', role: 'admin' })),
    check: checkGrant,
  },
  {
    label: 'remove grant',
    invoke: (testFixture) => testFixture.invoke(actions.removeGroupGrant, { ...group, projectId: 'p1' }),
    check: (testFixture) => {
      expect(
        testFixture.sqlite
          .prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'")
          .get(),
      ).toBeUndefined()
    },
  },
  {
    label: 'create/reveal token',
    invoke: (testFixture) =>
      testFixture.invoke(
        actions.createToken,
        JSON_NULL,
        formData({ ...workspace, name: ' Agent ', scope: 'read', expiry: '90' }),
      ),
    check: (testFixture) => {
      expect(
        testFixture.sqlite
          .prepare("SELECT name,scopes,user_id,workspace_id,expires_at FROM api_tokens WHERE name='Agent'")
          .get(),
      ).toMatchObject({
        expires_at: expect.any(Number),
        name: 'Agent',
        scopes: '["read"]',
        user_id: 'u1',
        workspace_id: 'w1',
      })
    },
  },
  {
    label: 'revoke token',
    invoke: (testFixture) => testFixture.invoke(actions.revokeToken, { ...workspace, tokenId: 't1' }),
    check: (testFixture) => {
      expect(testFixture.sqlite.prepare("SELECT id FROM api_tokens WHERE id='t1'").get()).toBeUndefined()
    },
  },
  {
    label: 'disconnect connector',
    invoke: (testFixture) => testFixture.invoke(actions.disconnectConnector, { ...workspace, connectorId: 'c1' }),
    check: async (testFixture) => {
      await expect(testFixture.oauthKV.get('grant:u1:c1')).resolves.toBeNull()
      await expect(testFixture.oauthKV.get('token:u1:c1:secret')).resolves.toBeNull()
      await expect(testFixture.oauthKV.get('grant:u1:c2')).resolves.not.toBeNull()
      await expect(testFixture.oauthKV.get('grant:u2:c3')).resolves.not.toBeNull()
    },
  },
]
const grantCases = cases.filter((operation) => operation.label.includes('grant'))
const settingsFixture = function settingsFixture(origin = 'https://front.example') {
  const testFixture = actionFixture(undefined, origin)
  testFixture.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u2','member@example.test','Member',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u2','member',1);
    INSERT INTO user_groups (id,workspace_id,name,description,created_at) VALUES ('g1','w1','Team','Existing',1);
    INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u2','u1',1);
    INSERT INTO api_tokens (id,workspace_id,user_id,name,token_hash,scopes,created_at) VALUES ('t1','w1','u1','Existing token','hash','["read"]',1);
  `)
  return testFixture
}
const memberFixture = function memberFixture() {
  const testFixture = settingsFixture()
  testFixture.sqlite.exec("UPDATE workspace_members SET role='member' WHERE user_id='u1'")
  return testFixture
}
const seedConnectors = async function seedConnectors(testFixture: Fixture): Promise<void> {
  await runInOrder(
    [
      ['c1', 'u1', 'w1'],
      ['c2', 'u1', 'w2'],
      ['c3', 'u2', 'w1'],
    ],
    async ([id, userId, workspaceId]): Promise<void> => {
      await testFixture.oauthKV.put(
        `grant:${userId}:${id}`,
        JSON.stringify({
          id,
          userId,
          clientId: 'https://claude.ai',
          scope: ['projektor:read'],
          metadata: { workspaceId },
          createdAt: 1,
          expiresAt: 2_000_000_000,
        }),
      )
    },
  )
  await testFixture.oauthKV.put('token:u1:c1:secret', 'opaque-token')
}

describe('explicit settings ServerFns use real shared commands and authoritative scopes', () => {
  test('serializes a real command database failure without leaking driver details', async () => {
    const testFixture = settingsFixture()
    testFixture.sqlite.exec(
      "CREATE TRIGGER private_error BEFORE INSERT ON api_tokens BEGIN SELECT RAISE(ABORT, 'private driver detail'); END",
    )
    const result = await testFixture.invoke(
      actions.createToken,
      JSON_NULL,
      formData({ ...workspace, name: 'Agent', scope: 'read', expiry: '' }),
    )
    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(JSON.stringify(result)).not.toContain('private driver detail')
    expect(testFixture.invalidated).toHaveBeenCalledOnce()
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test.each(grantCases)('$label accepts archived owner targets outside the active catalog', async (operation) => {
    const testFixture = settingsFixture()
    testFixture.sqlite.exec("UPDATE projects SET archived_at=2 WHERE id='p1'")
    await expect(operation.invoke(testFixture)).resolves.toStrictEqual({ ok: true, value: { ok: true } })
    await operation.check(testFixture)
    expect(testFixture.transport).not.toHaveBeenCalled()
    expect(testFixture.invalidated).toHaveBeenCalledOnce()
  })

  test.each(grantCases)(
    '$label rejects foreign, missing and ungranted member targets before mutation',
    async (operation) => {
      expect.hasAssertions()
      const foreign = settingsFixture()
      foreign.sqlite.exec("UPDATE projects SET workspace_id='w2', archived_at=2 WHERE id='p1'")
      const missing = settingsFixture()
      missing.sqlite.exec("DELETE FROM projects WHERE id='p1'")
      const member = memberFixture()
      member.sqlite.exec("UPDATE projects SET archived_at=2 WHERE id='p1'")
      await runInOrder([foreign, missing, member], async (testFixture): Promise<void> => {
        await expect(operation.invoke(testFixture)).resolves.toMatchObject({ ok: false, status: 404 })
        expect(
          testFixture.sqlite
            .prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'")
            .get(),
        ).toBeUndefined()
        expect(testFixture.transport).not.toHaveBeenCalled()
        expect(testFixture.invalidated).toHaveBeenCalledOnce()
      })
    },
  )

  test.each(grantCases)(
    '$label preserves archived granted-member visibility but shared commands enforce admin mutation',
    async (operation) => {
      const testFixture = memberFixture()
      testFixture.sqlite.exec(
        "UPDATE projects SET archived_at=2 WHERE id='p1'; INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1); INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');",
      )
      await expect(operation.invoke(testFixture)).resolves.toMatchObject({ ok: false, status: 403 })
      expect(
        testFixture.sqlite
          .prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'")
          .get()?.role,
      ).toBe('viewer')
      expect(testFixture.transport).not.toHaveBeenCalled()
      expect(testFixture.invalidated).toHaveBeenCalledOnce()
    },
  )

  test.each(cases)('$label has concrete storage effects and invalidates canonical SSR views', async (operation) => {
    const testFixture = settingsFixture()
    if (operation.label === 'remove grant') {
      testFixture.sqlite.exec("INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer')")
    }
    await seedConnectors(testFixture)
    const result = await operation.invoke(testFixture)
    if (operation.label === 'create group') {
      expect(result).toStrictEqual({ ok: true, value: { id: expect.any(String) } })
    } else if (operation.label === 'create/reveal token') {
      expect(result).toStrictEqual({
        ok: true,
        value: {
          expiresAt: expect.any(Number),
          id: expect.any(String),
          name: 'Agent',
          scopes: ['read'],
          token: expect.stringMatching(/^pk_[0-9a-f]{64}$/u),
        },
      })
    } else {
      expect(result).toStrictEqual({ ok: true, value: { ok: true } })
    }
    await operation.check(testFixture)
    expect(testFixture.transport).not.toHaveBeenCalled()
    expect(testFixture.invalidated).toHaveBeenCalledOnce()
  })

  test('rejects foreign workspace/project selection before any write', async () => {
    const testFixture = settingsFixture()
    await expect(
      testFixture.invoke(actions.createGroup, JSON_NULL, formData({ workspaceSlug: 'beta', name: 'Foreign team' })),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    await expect(
      testFixture.invoke(actions.setGroupGrant, { ...group, projectId: 'foreign', role: 'member' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
    })
    expect(testFixture.sqlite.prepare("SELECT id FROM user_groups WHERE name='Foreign team'").get()).toBeUndefined()
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('guards origin and maps concrete connector not-found failures while invalidating', async () => {
    const origin = settingsFixture('https://other.example')
    await expect(origin.invoke(actions.revokeToken, { ...workspace, tokenId: 't1' })).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    expect(origin.sqlite.prepare("SELECT id FROM api_tokens WHERE id='t1'").get()).toBeDefined()
    expect(origin.transport).not.toHaveBeenCalled()
    expect(origin.invalidated).toHaveBeenCalledOnce()
    const testFixture = settingsFixture()
    await expect(
      testFixture.invoke(actions.disconnectConnector, { ...workspace, connectorId: 'missing' }),
    ).resolves.toStrictEqual({
      message: 'Connector not found',
      ok: false,
      status: 404,
    })
    expect(testFixture.invalidated).toHaveBeenCalledOnce()
  })

  test('validates Effect fields and preserves concrete read/write token creation shapes', async () => {
    const testFixture = settingsFixture()
    await expect(
      testFixture.invoke(actions.createGroup, JSON_NULL, formData({ ...workspace, name: '  ' })),
    ).rejects.toMatchObject({
      _tag: 'SchemaError',
    })
    await expect(
      testFixture.invoke(
        actions.createToken,
        JSON_NULL,
        formData({ ...workspace, name: 'Agent', scope: 'read', expiry: '1.5' }),
      ),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    await expect(
      testFixture.invoke(
        actions.createToken,
        JSON_NULL,
        formData({ ...workspace, name: 'Writer', scope: 'readwrite', expiry: '' }),
      ),
    ).resolves.toMatchObject({ ok: true, value: { expiresAt: JSON_NULL, scopes: ['read', 'write'] } })
    expect(
      testFixture.sqlite.prepare("SELECT scopes,expires_at FROM api_tokens WHERE name='Writer'").get(),
    ).toMatchObject({
      expires_at: SQL_NULL,
      scopes: '["read","write"]',
    })
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('refuses workspace token minting by a real member', async () => {
    const testFixture = memberFixture()
    await expect(
      testFixture.invoke(
        actions.createToken,
        JSON_NULL,
        formData({ ...workspace, name: 'Denied', scope: 'read', expiry: '' }),
      ),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    expect(testFixture.sqlite.prepare("SELECT id FROM api_tokens WHERE name='Denied'").get()).toBeUndefined()
  })

  test('refuses credential minting and connector revocation for the public viewer identity', async () => {
    const testFixture = actionFixture(undefined, 'https://front.example', {
      DEV_USER_EMAIL: 'public-viewer@projektor.local',
    })
    testFixture.sqlite.exec("UPDATE users SET email='public-viewer@projektor.local' WHERE id='u1'")
    await expect(
      testFixture.invoke(
        actions.createToken,
        JSON_NULL,
        formData({ ...workspace, name: 'Public token', scope: 'read', expiry: '' }),
      ),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    await expect(
      testFixture.invoke(actions.disconnectConnector, { ...workspace, connectorId: 'c1' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    expect(testFixture.sqlite.prepare("SELECT id FROM api_tokens WHERE name='Public token'").get()).toBeUndefined()
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('cannot revoke a connector owned by another user or workspace', async () => {
    expect.hasAssertions()
    const testFixture = settingsFixture()
    await seedConnectors(testFixture)
    await runInOrder(['c2', 'c3'], async (connectorId): Promise<void> => {
      await expect(
        testFixture.invoke(actions.disconnectConnector, { ...workspace, connectorId }),
      ).resolves.toMatchObject({
        ok: false,
        status: 404,
      })
    })
    await expect(testFixture.oauthKV.get('grant:u1:c2')).resolves.not.toBeNull()
    await expect(testFixture.oauthKV.get('grant:u2:c3')).resolves.not.toBeNull()
  })
})
