import { describe, expect, it, vi } from 'vite-plus/test'

// Only the Node host entrypoint is substituted. Real OAuth helpers and KV operations execute.
vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }))

import { actionFixture, formData } from '../planning/action-test-fixture'

const actions = await import('./actions')
type Fixture = ReturnType<typeof actionFixture>
const workspace = { workspaceSlug: 'alpha' }
const group = { ...workspace, groupId: 'g1' }
const cases: {
  label: string
  invoke: (test: Fixture) => Promise<unknown>
  check: (test: Fixture) => void | Promise<void>
}[] = [
  {
    label: 'create group',
    invoke: (test) => test.invoke(actions.createGroup, null, formData({ ...workspace, name: ' New team ' })),
    check: (test) => {
      expect(test.sqlite.prepare("SELECT name FROM user_groups WHERE name='New team'").get()?.name).toBe('New team')
    },
  },
  {
    label: 'rename group',
    invoke: (test) => test.invoke(actions.renameGroup, null, formData({ ...group, name: ' Renamed ' })),
    check: (test) => {
      expect(test.sqlite.prepare("SELECT name FROM user_groups WHERE id='g1'").get()?.name).toBe('Renamed')
    },
  },
  {
    label: 'save description',
    invoke: (test) => test.invoke(actions.describeGroup, null, formData({ ...group, description: ' ' })),
    check: (test) => {
      expect(test.sqlite.prepare("SELECT description FROM user_groups WHERE id='g1'").get()?.description).toBeNull()
    },
  },
  {
    label: 'delete group',
    invoke: (test) => test.invoke(actions.deleteGroup, group),
    check: (test) => {
      expect(test.sqlite.prepare("SELECT id FROM user_groups WHERE id='g1'").get()).toBeUndefined()
      expect(test.sqlite.prepare("SELECT group_id FROM user_group_members WHERE group_id='g1'").all()).toEqual([])
    },
  },
  {
    label: 'add member',
    invoke: (test) => test.invoke(actions.addGroupMember, null, formData({ ...group, userId: 'u1' })),
    check: (test) => {
      expect(
        test.sqlite.prepare("SELECT user_id FROM user_group_members WHERE group_id='g1' AND user_id='u1'").get()
          ?.user_id,
      ).toBe('u1')
    },
  },
  {
    label: 'remove member',
    invoke: (test) => test.invoke(actions.removeGroupMember, { ...group, userId: 'u2' }),
    check: (test) => {
      expect(
        test.sqlite.prepare("SELECT user_id FROM user_group_members WHERE group_id='g1' AND user_id='u2'").get(),
      ).toBeUndefined()
    },
  },
  {
    label: 'create/update grant',
    invoke: (test) => test.invoke(actions.setGroupGrant, { ...group, projectId: 'p1', role: 'admin' }),
    check: checkGrant,
  },
  {
    label: 'native create grant',
    invoke: (test) =>
      test.invoke(actions.createGroupGrant, null, formData({ ...group, projectId: 'p1', role: 'admin' })),
    check: checkGrant,
  },
  {
    label: 'remove grant',
    invoke: (test) => test.invoke(actions.removeGroupGrant, { ...group, projectId: 'p1' }),
    check: (test) => {
      expect(
        test.sqlite.prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'").get(),
      ).toBeUndefined()
    },
  },
  {
    label: 'create/reveal token',
    invoke: (test) =>
      test.invoke(actions.createToken, null, formData({ ...workspace, name: ' Agent ', scope: 'read', expiry: '90' })),
    check: (test) => {
      expect(
        test.sqlite
          .prepare("SELECT name,scopes,user_id,workspace_id,expires_at FROM api_tokens WHERE name='Agent'")
          .get(),
      ).toMatchObject({
        name: 'Agent',
        scopes: '["read"]',
        user_id: 'u1',
        workspace_id: 'w1',
        expires_at: expect.any(Number),
      })
    },
  },
  {
    label: 'revoke token',
    invoke: (test) => test.invoke(actions.revokeToken, { ...workspace, tokenId: 't1' }),
    check: (test) => {
      expect(test.sqlite.prepare("SELECT id FROM api_tokens WHERE id='t1'").get()).toBeUndefined()
    },
  },
  {
    label: 'disconnect connector',
    invoke: (test) => test.invoke(actions.disconnectConnector, { ...workspace, connectorId: 'c1' }),
    check: async (test) => {
      expect(await test.oauthKV.get('grant:u1:c1')).toBeNull()
      expect(await test.oauthKV.get('token:u1:c1:secret')).toBeNull()
      expect(await test.oauthKV.get('grant:u1:c2')).not.toBeNull()
      expect(await test.oauthKV.get('grant:u2:c3')).not.toBeNull()
    },
  },
]
const grantCases = cases.filter((operation) => operation.label.includes('grant'))
function checkGrant(test: Fixture) {
  expect(
    test.sqlite.prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'").get()?.role,
  ).toBe('admin')
}
function settingsFixture(origin = 'https://front.example') {
  const test = actionFixture(undefined, origin)
  test.sqlite.exec(`
    INSERT INTO users (id,email,name,created_at) VALUES ('u2','member@example.test','Member',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u2','member',1);
    INSERT INTO user_groups (id,workspace_id,name,description,created_at) VALUES ('g1','w1','Team','Existing',1);
    INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u2','u1',1);
    INSERT INTO api_tokens (id,workspace_id,user_id,name,token_hash,scopes,created_at) VALUES ('t1','w1','u1','Existing token','hash','["read"]',1);
  `)
  return test
}
function memberFixture() {
  const test = settingsFixture()
  test.sqlite.exec("UPDATE workspace_members SET role='member' WHERE user_id='u1'")
  return test
}
async function seedConnectors(test: Fixture) {
  for (const [id, userId, workspaceId] of [
    ['c1', 'u1', 'w1'],
    ['c2', 'u1', 'w2'],
    ['c3', 'u2', 'w1'],
  ]) {
    await test.oauthKV.put(
      `grant:${userId}:${id}`,
      JSON.stringify({
        id,
        userId,
        clientId: 'https://claude.ai',
        scope: ['projektor:read'],
        metadata: { workspaceId },
        createdAt: 1,
        expiresAt: 2000000000,
      }),
    )
  }
  await test.oauthKV.put('token:u1:c1:secret', 'opaque-token')
}

describe('explicit settings ServerFns use real shared commands and authoritative scopes', () => {
  it('serializes a real command database failure without leaking driver details', async () => {
    const test = settingsFixture()
    test.sqlite.exec(
      "CREATE TRIGGER private_error BEFORE INSERT ON api_tokens BEGIN SELECT RAISE(ABORT, 'private driver detail'); END",
    )
    const result = await test.invoke(
      actions.createToken,
      null,
      formData({ ...workspace, name: 'Agent', scope: 'read', expiry: '' }),
    )
    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(JSON.stringify(result)).not.toContain('private driver detail')
    expect(test.invalidated).toHaveBeenCalledTimes(1)
    expect(test.transport).not.toHaveBeenCalled()
  })
  it.each(grantCases)('$label accepts archived owner targets outside the active catalog', async (operation) => {
    const test = settingsFixture()
    test.sqlite.exec("UPDATE projects SET archived_at=2 WHERE id='p1'")
    expect(await operation.invoke(test)).toEqual({ ok: true, value: { ok: true } })
    await operation.check(test)
    expect(test.transport).not.toHaveBeenCalled()
    expect(test.invalidated).toHaveBeenCalledTimes(1)
  })
  it.each(grantCases)(
    '$label rejects foreign, missing and ungranted member targets before mutation',
    async (operation) => {
      const foreign = settingsFixture()
      foreign.sqlite.exec("UPDATE projects SET workspace_id='w2', archived_at=2 WHERE id='p1'")
      const missing = settingsFixture()
      missing.sqlite.exec("DELETE FROM projects WHERE id='p1'")
      const member = memberFixture()
      member.sqlite.exec("UPDATE projects SET archived_at=2 WHERE id='p1'")
      for (const test of [foreign, missing, member]) {
        expect(await operation.invoke(test)).toMatchObject({ ok: false, status: 404 })
        expect(
          test.sqlite.prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'").get(),
        ).toBeUndefined()
        expect(test.transport).not.toHaveBeenCalled()
        expect(test.invalidated).toHaveBeenCalledTimes(1)
      }
    },
  )
  it.each(grantCases)(
    '$label preserves archived granted-member visibility but shared commands enforce admin mutation',
    async (operation) => {
      const test = memberFixture()
      test.sqlite.exec(
        "UPDATE projects SET archived_at=2 WHERE id='p1'; INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1); INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer');",
      )
      expect(await operation.invoke(test)).toMatchObject({ ok: false, status: 403 })
      expect(
        test.sqlite.prepare("SELECT role FROM group_project_grants WHERE group_id='g1' AND project_id='p1'").get()
          ?.role,
      ).toBe('viewer')
      expect(test.transport).not.toHaveBeenCalled()
      expect(test.invalidated).toHaveBeenCalledTimes(1)
    },
  )
  it.each(cases)('$label has concrete storage effects and invalidates canonical SSR views', async (operation) => {
    const test = settingsFixture()
    if (operation.label === 'remove grant')
      test.sqlite.exec("INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','viewer')")
    await seedConnectors(test)
    const result = await operation.invoke(test)
    if (operation.label === 'create group') expect(result).toEqual({ ok: true, value: { id: expect.any(String) } })
    else if (operation.label === 'create/reveal token')
      expect(result).toEqual({
        ok: true,
        value: {
          id: expect.any(String),
          name: 'Agent',
          token: expect.stringMatching(/^pk_[0-9a-f]{64}$/),
          scopes: ['read'],
          expiresAt: expect.any(Number),
        },
      })
    else expect(result).toEqual({ ok: true, value: { ok: true } })
    await operation.check(test)
    expect(test.transport).not.toHaveBeenCalled()
    expect(test.invalidated).toHaveBeenCalledTimes(1)
  })
  it('rejects foreign workspace/project selection before any write', async () => {
    const test = settingsFixture()
    expect(
      await test.invoke(actions.createGroup, null, formData({ workspaceSlug: 'beta', name: 'Foreign team' })),
    ).toMatchObject({ ok: false, status: 403 })
    expect(await test.invoke(actions.setGroupGrant, { ...group, projectId: 'foreign', role: 'member' })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(test.sqlite.prepare("SELECT id FROM user_groups WHERE name='Foreign team'").get()).toBeUndefined()
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('guards origin and maps concrete connector not-found failures while invalidating', async () => {
    const origin = settingsFixture('https://other.example')
    expect(await origin.invoke(actions.revokeToken, { ...workspace, tokenId: 't1' })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(origin.sqlite.prepare("SELECT id FROM api_tokens WHERE id='t1'").get()).toBeDefined()
    expect(origin.transport).not.toHaveBeenCalled()
    expect(origin.invalidated).toHaveBeenCalledTimes(1)
    const test = settingsFixture()
    expect(await test.invoke(actions.disconnectConnector, { ...workspace, connectorId: 'missing' })).toEqual({
      ok: false,
      status: 404,
      message: 'Connector not found',
    })
    expect(test.invalidated).toHaveBeenCalledTimes(1)
  })
  it('validates Effect fields and preserves concrete read/write token creation shapes', async () => {
    const test = settingsFixture()
    await expect(test.invoke(actions.createGroup, null, formData({ ...workspace, name: '  ' }))).rejects.toMatchObject({
      _tag: 'SchemaError',
    })
    await expect(
      test.invoke(actions.createToken, null, formData({ ...workspace, name: 'Agent', scope: 'read', expiry: '1.5' })),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(
      await test.invoke(
        actions.createToken,
        null,
        formData({ ...workspace, name: 'Writer', scope: 'readwrite', expiry: '' }),
      ),
    ).toMatchObject({ ok: true, value: { scopes: ['read', 'write'], expiresAt: null } })
    expect(test.sqlite.prepare("SELECT scopes,expires_at FROM api_tokens WHERE name='Writer'").get()).toMatchObject({
      scopes: '["read","write"]',
      expires_at: null,
    })
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('refuses workspace token minting by a real member', async () => {
    const test = memberFixture()
    expect(
      await test.invoke(
        actions.createToken,
        null,
        formData({ ...workspace, name: 'Denied', scope: 'read', expiry: '' }),
      ),
    ).toMatchObject({ ok: false, status: 403 })
    expect(test.sqlite.prepare("SELECT id FROM api_tokens WHERE name='Denied'").get()).toBeUndefined()
  })
  it('refuses credential minting and connector revocation for the public viewer identity', async () => {
    const test = actionFixture(undefined, 'https://front.example', { DEV_USER_EMAIL: 'public-viewer@projektor.local' })
    test.sqlite.exec("UPDATE users SET email='public-viewer@projektor.local' WHERE id='u1'")
    expect(
      await test.invoke(
        actions.createToken,
        null,
        formData({ ...workspace, name: 'Public token', scope: 'read', expiry: '' }),
      ),
    ).toMatchObject({ ok: false, status: 403 })
    expect(await test.invoke(actions.disconnectConnector, { ...workspace, connectorId: 'c1' })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(test.sqlite.prepare("SELECT id FROM api_tokens WHERE name='Public token'").get()).toBeUndefined()
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('cannot revoke a connector owned by another user or workspace', async () => {
    const test = settingsFixture()
    await seedConnectors(test)
    for (const connectorId of ['c2', 'c3'])
      expect(await test.invoke(actions.disconnectConnector, { ...workspace, connectorId })).toMatchObject({
        ok: false,
        status: 404,
      })
    expect(await test.oauthKV.get('grant:u1:c2')).not.toBeNull()
    expect(await test.oauthKV.get('grant:u2:c3')).not.toBeNull()
  })
})
