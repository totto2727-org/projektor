import { describe, expect, it } from 'vite-plus/test'

import { actionFixture, formData } from '../planning/action-test-fixture'

const actions = await import('./actions')
type Fixture = ReturnType<typeof actionFixture>
const workspace = { workspaceSlug: 'alpha' }
const group = { ...workspace, groupId: 'g1' }
const token = { id: 't1', name: 'Agent', token: 'pk_secret', scopes: ['read'], expiresAt: null }
const cases: {
  label: string
  invoke: (fixture: Fixture) => Promise<unknown>
  path: string
  method: string
  body?: unknown
  result?: unknown
}[] = [
  {
    label: 'create group',
    invoke: (fixture) => fixture.invoke(actions.createGroup, null, formData({ ...workspace, name: ' Team ' })),
    path: 'groups',
    method: 'POST',
    body: { name: 'Team' },
    result: { id: 'g1' },
  },
  {
    label: 'rename group',
    invoke: (fixture) => fixture.invoke(actions.renameGroup, null, formData({ ...group, name: ' Renamed ' })),
    path: 'groups/g1',
    method: 'PATCH',
    body: { name: 'Renamed' },
  },
  {
    label: 'save description',
    invoke: (fixture) => fixture.invoke(actions.describeGroup, null, formData({ ...group, description: ' ' })),
    path: 'groups/g1',
    method: 'PATCH',
    body: { description: null },
  },
  {
    label: 'delete group',
    invoke: (fixture) => fixture.invoke(actions.deleteGroup, group),
    path: 'groups/g1',
    method: 'DELETE',
  },
  {
    label: 'add member',
    invoke: (fixture) => fixture.invoke(actions.addGroupMember, null, formData({ ...group, userId: 'u2' })),
    path: 'groups/g1/members',
    method: 'POST',
    body: { userId: 'u2' },
  },
  {
    label: 'remove member',
    invoke: (fixture) => fixture.invoke(actions.removeGroupMember, { ...group, userId: 'u2' }),
    path: 'groups/g1/members/u2',
    method: 'DELETE',
  },
  {
    label: 'create/update grant',
    invoke: (fixture) => fixture.invoke(actions.setGroupGrant, { ...group, projectId: 'p1', role: 'admin' }),
    path: 'groups/g1/grants',
    method: 'PUT',
    body: { projectId: 'p1', role: 'admin' },
  },
  {
    label: 'native create grant',
    invoke: (fixture) =>
      fixture.invoke(actions.createGroupGrant, null, formData({ ...group, projectId: 'p1', role: 'admin' })),
    path: 'groups/g1/grants',
    method: 'PUT',
    body: { projectId: 'p1', role: 'admin' },
  },
  {
    label: 'remove grant',
    invoke: (fixture) => fixture.invoke(actions.removeGroupGrant, { ...group, projectId: 'p1' }),
    path: 'groups/g1/grants/p1',
    method: 'DELETE',
  },
  {
    label: 'create/reveal token',
    invoke: (fixture) =>
      fixture.invoke(
        actions.createToken,
        null,
        formData({
          ...workspace,
          name: ' Agent ',
          scope: 'read',
          expiry: '90',
        }),
      ),
    path: 'tokens',
    method: 'POST',
    body: { name: 'Agent', scopes: ['read'], expiresInDays: 90 },
    result: token,
  },
  {
    label: 'revoke token',
    invoke: (fixture) => fixture.invoke(actions.revokeToken, { ...workspace, tokenId: 't1' }),
    path: 'tokens/t1',
    method: 'DELETE',
  },
  {
    label: 'disconnect connector',
    invoke: (fixture) => fixture.invoke(actions.disconnectConnector, { ...workspace, connectorId: 'c1' }),
    path: 'connectors/c1',
    method: 'DELETE',
  },
]
const writes = (fixture: Fixture) => fixture.transport.mock.calls.filter(([, options]) => options?.method !== 'GET')

describe('explicit settings ServerFns and authoritative Effect scopes', () => {
  it('decodes each native token response concretely and serializes JSON/schema failures without leaking body details', async () => {
    const invalidJson = actionFixture(
      () => new Response('private invalid body', { headers: { 'content-type': 'application/json' } }),
    )
    const result = await invalidJson.invoke(
      actions.createToken,
      null,
      formData({ ...workspace, name: 'Agent', scope: 'read', expiry: '' }),
    )
    expect(result).toMatchObject({ ok: false, status: 502 })
    expect(JSON.stringify(result)).not.toContain('private invalid body')
    expect(invalidJson.invalidated).toHaveBeenCalledTimes(1)
  })
  it('updates and removes existing archived-project grants without treating target IDs as page selectors', async () => {
    const fixture = actionFixture((url) =>
      url.pathname.startsWith('/api/projects/') ? { id: 'archived', workspaceId: 'w1' } : { ok: true },
    )
    expect(
      await fixture.invoke(actions.setGroupGrant, {
        ...group,
        projectId: 'archived',
        role: 'viewer',
      }),
    ).toEqual({ ok: true, value: { ok: true } })
    expect(await fixture.invoke(actions.removeGroupGrant, { ...group, projectId: 'archived' })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(writes(fixture)).toHaveLength(2)
    expect(fixture.invalidated).toHaveBeenCalledTimes(2)
  })
  it.each(cases)('$label owns its fixed wire contract and invalidates canonical SSR views', async (operation) => {
    const fixture = actionFixture((url) =>
      url.pathname.startsWith('/api/projects/') ? { id: 'p1', workspaceId: 'w1' } : (operation.result ?? { ok: true }),
    )
    expect(await operation.invoke(fixture)).toEqual({
      ok: true,
      value: operation.result ?? { ok: true },
    })
    const [url, options] = writes(fixture)[0]
    expect(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).toBe(
      `https://api.example/api/workspaces/alpha/${operation.path}`,
    )
    expect(options?.method).toBe(operation.method)
    expect(options?.body === undefined ? undefined : await new Response(options.body).json()).toEqual(operation.body)
    expect(new Headers(options?.headers).get('x-workspace-slug')).toBe('alpha')
    expect(new Headers(options?.headers).get('authorization')).toBeNull()
    expect(new Headers(options?.headers).get('cookie')).toBe('CF_Authorization=actual-user')
    expect(fixture.invalidated).toHaveBeenCalledTimes(1)
  })
  it('rejects foreign workspace/project selection before any write', async () => {
    const foreignWorkspace = actionFixture(() => ({ id: 'g1' }))
    expect(
      await foreignWorkspace.invoke(actions.createGroup, null, formData({ workspaceSlug: 'beta', name: 'Team' })),
    ).toMatchObject({ ok: false, status: 403 })
    expect(writes(foreignWorkspace)).toEqual([])
    const foreignProject = actionFixture(() => ({ id: 'foreign', workspaceId: 'w2' }))
    expect(
      await foreignProject.invoke(actions.setGroupGrant, {
        ...group,
        projectId: 'foreign',
        role: 'member',
      }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(writes(foreignProject)).toEqual([])
  })
  it('guards origin and redacts expected HTTP failures while still invalidating', async () => {
    const origin = actionFixture(() => ({ ok: true }), 'https://other.example')
    expect(await origin.invoke(actions.revokeToken, { ...workspace, tokenId: 't1' })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(origin.transport).not.toHaveBeenCalled()
    expect(origin.invalidated).toHaveBeenCalledTimes(1)
    const denied = actionFixture(() => new Response('private upstream detail', { status: 403 }))
    const result = await denied.invoke(actions.disconnectConnector, {
      ...workspace,
      connectorId: 'c1',
    })
    expect(result).toEqual({ ok: false, status: 403, message: 'The API request failed (403).' })
    expect(denied.invalidated).toHaveBeenCalledTimes(1)
  })
  it('validates the same Effect fields before HTTP and preserves distinct token creation schemas', async () => {
    const fixture = actionFixture(() => token)
    await expect(
      fixture.invoke(actions.createGroup, null, formData({ ...workspace, name: '  ' })),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    await expect(
      fixture.invoke(
        actions.createToken,
        null,
        formData({
          ...workspace,
          name: 'Agent',
          scope: 'read',
          expiry: '1.5',
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(fixture.transport).not.toHaveBeenCalled()
    const malformed = actionFixture(() => ({ ...token, scopes: '["read"]' }))
    expect(
      await malformed.invoke(
        actions.createToken,
        null,
        formData({
          ...workspace,
          name: 'Agent',
          scope: 'readwrite',
          expiry: '',
        }),
      ),
    ).toMatchObject({ ok: false, status: 502 })
    expect(malformed.invalidated).toHaveBeenCalledTimes(1)
  })
})
