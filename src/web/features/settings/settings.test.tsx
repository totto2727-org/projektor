// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { ConnectAgentGuide } from './ConnectAgentGuide'
import { ConnectorManager } from './ConnectorManager'
import { GroupManager } from './GroupManager'
import { TokenManager } from './TokenManager'
import type { ConnectorGrant, GroupData, Token } from './types'

const request = vi.hoisted(() => vi.fn())
const nativeSubmitted = vi.hoisted(() => vi.fn())
vi.mock('./actions', () => ({
  createGroup: (previous: unknown, data: FormData) => {
    nativeSubmitted('createGroup', previous, data)
    return request('createGroup', Object.fromEntries(data))
  },
  deleteGroup: (input: unknown) => request('deleteGroup', input),
  renameGroup: (previous: unknown, data: FormData) => {
    nativeSubmitted('renameGroup', previous, data)
    return request('renameGroup', Object.fromEntries(data))
  },
  describeGroup: (previous: unknown, data: FormData) => {
    nativeSubmitted('describeGroup', previous, data)
    return request('describeGroup', Object.fromEntries(data))
  },
  addGroupMember: (previous: unknown, data: FormData) => {
    nativeSubmitted('addMember', previous, data)
    return request('addMember', Object.fromEntries(data))
  },
  createGroupGrant: (previous: unknown, data: FormData) => {
    nativeSubmitted('createGrant', previous, data)
    return request('setGrant', Object.fromEntries(data))
  },
  removeGroupMember: (input: unknown) => request('removeMember', input),
  setGroupGrant: (input: unknown) => request('setGrant', input),
  removeGroupGrant: (input: unknown) => request('removeGrant', input),
  createToken: (previous: unknown, data: FormData) => {
    nativeSubmitted('createToken', previous, data)
    return request('createToken', Object.fromEntries(data))
  },
  revokeToken: (input: unknown) => request('revokeToken', input),
  disconnectConnector: (input: unknown) => request('disconnect', input),
}))
const groupData = (): GroupData => ({
  role: 'admin',
  groups: [{ id: 'g1', name: 'Team', description: 'Original', memberCount: 1, grantCount: 1 }],
  details: [
    {
      id: 'g1',
      name: 'Team',
      description: 'Original',
      memberCount: 1,
      grantCount: 1,
      members: [{ userId: 'u1', name: 'Alice', email: 'alice@example.test' }],
      grants: [{ projectId: 'p1', projectName: 'Project One', projectKey: 'ONE', role: 'viewer' }],
    },
  ],
  members: [
    { id: 'u1', name: 'Alice', email: 'alice@example.test', role: 'member' },
    { id: 'u2', name: 'Bob', email: 'bob@example.test', role: 'member' },
    { id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'admin' },
  ],
  memberGroups: [{ userId: 'u1', groups: [{ id: 'g1', name: 'Team' }] }],
  projects: [
    { id: 'p1', name: 'Project One', key: 'ONE', workspace_slug: 'alpha' },
    { id: 'p2', name: 'Project Two', key: 'TWO', workspace_slug: 'alpha' },
  ],
})
const token = (name = 'Agent'): Token => ({
  id: 't1',
  name,
  scopes: '["read","write"]',
  lastUsedAt: null,
  expiresAt: null,
  createdAt: 1,
})
const grant = (client = 'Claude'): ConnectorGrant => ({
  id: 'c1',
  client,
  clientId: 'client',
  scopes: ['projektor:read', 'projektor:write'],
  grantedAt: 1,
  expiresAt: 2000000000,
})
const groupScope = { workspaceSlug: 'alpha', groupId: 'g1' }
afterEach(cleanup)
beforeEach(() => {
  request.mockReset()
  nativeSubmitted.mockReset()
  request.mockResolvedValue({ ok: true, value: { ok: true } })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('original settings controls with TanStack schemas and semantic ServerFns', () => {
  it('keeps native group creation drafts after typed failure and clears them only after success', async () => {
    request.mockResolvedValueOnce({ ok: false, status: 409, message: 'Group conflict' })
    render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Retry team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Group conflict'))
    expect((screen.getByLabelText('New group name') as HTMLInputElement).value).toBe('Retry team')
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect((screen.getByLabelText('New group name') as HTMLInputElement).value).toBe(''))
  })
  it('never fetches primary lists/details and preserves all active group form drafts on canonical refresh', () => {
    const view = render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Team' })[0])
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Unsaved rename' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Unsaved description' },
    })
    fireEvent.change(screen.getByLabelText('New group name'), {
      target: { value: 'Unsaved new group' },
    })
    const next = groupData()
    next.groups[0].name = 'Server Team'
    next.details[0].name = 'Server Team'
    next.details[0].members = [{ userId: 'u2', name: 'Bob', email: 'bob@example.test' }]
    view.rerender(<GroupManager workspaceSlug='alpha' initialData={next} />)
    expect(screen.getAllByRole('button', { name: 'Server Team' }).length).toBe(2)
    expect(screen.getByLabelText('Remove Bob')).toBeTruthy()
    expect(screen.queryByLabelText('Remove Alice')).toBeNull()
    expect((screen.getByLabelText('Group name') as HTMLInputElement).value).toBe('Unsaved rename')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Unsaved description')
    expect((screen.getByLabelText('New group name') as HTMLInputElement).value).toBe('Unsaved new group')
    expect(request).not.toHaveBeenCalled()
  })
  it('submits original rename/description/member/grant controls through typed semantic actions', async () => {
    render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Team' })[0])
    const submitted = async (operation: string, fields: object) => {
      await waitFor(() => expect(request).toHaveBeenLastCalledWith(operation, { ...groupScope, ...fields }))
      await waitFor(() =>
        expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(false),
      )
    }
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: ' Renamed ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await submitted('renameGroup', { name: ' Renamed ' })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'New description' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }))
    await submitted('describeGroup', { description: 'New description' })
    fireEvent.change(screen.getByLabelText('Add a member'), { target: { value: 'u2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await submitted('addMember', { userId: 'u2' })
    fireEvent.click(screen.getByLabelText('Remove Alice'))
    await submitted('removeMember', { userId: 'u1' })
    fireEvent.change(screen.getByLabelText('Role for Project One'), {
      target: { value: 'member' },
    })
    await submitted('setGrant', { projectId: 'p1', role: 'member' })
    fireEvent.click(screen.getByLabelText('Remove grant for Project One'))
    await submitted('removeGrant', { projectId: 'p1' })
    fireEvent.change(screen.getByLabelText('Grant a project'), { target: { value: 'p2' } })
    fireEvent.change(screen.getByLabelText('New grant role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }))
    await submitted('setGrant', { projectId: 'p2', role: 'admin' })
    for (const operation of ['renameGroup', 'describeGroup', 'addMember', 'createGrant'])
      expect(nativeSubmitted).toHaveBeenCalledWith(operation, null, expect.any(FormData))
  })
  it('creates groups without fake aggregate DTOs and requires deletion confirmation', async () => {
    render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'New team' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('createGroup', {
        workspaceSlug: 'alpha',
        name: 'New team',
      }),
    )
    await waitFor(() => expect((screen.getByLabelText('New group name') as HTMLInputElement).value).toBe(''))
    const count = request.mock.calls.length
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(request.mock.calls.length).toBe(count)
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => expect(request).toHaveBeenLastCalledWith('deleteGroup', groupScope))
  })
  it('retains accessible tabs, member chips/pending/admin bypass and read-only groups', () => {
    const data = groupData()
    const view = render(<GroupManager workspaceSlug='alpha' initialData={data} />)
    expect(screen.getByRole('heading', { name: 'Groups', level: 1 })).toBeTruthy()
    expect(screen.getByText(/Groups grant members access to projects/)).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Groups' }), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Members' }))
    expect(screen.getByRole('tabpanel').id).toBe('group-tabpanel-groups')
    const target = new URL(
      screen.getByRole('tab', { name: 'Members' }).getAttribute('href') ?? '',
      'https://front.example',
    )
    expect(target.pathname).toBe('/settings/groups')
    expect(target.searchParams.get('view')).toBe('members')
    expect(target.searchParams.get('workspace')).toBe('alpha')
    view.rerender(<GroupManager workspaceSlug='alpha' initialData={data} view='members' />)
    expect(screen.getByRole('tabpanel').id).toBe('group-tabpanel-members')
    expect(screen.getAllByText('Pending: no access').length).toBe(2)
    expect(screen.getAllByText('All projects (bypasses groups)').length).toBe(2)
    view.rerender(<GroupManager workspaceSlug='alpha' initialData={{ ...data, role: 'viewer', details: [] }} />)
    expect(screen.getByRole('heading', { name: 'Groups', level: 1 })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Team' })).toBeNull()
  })
  it('preserves token form fields on refresh and reveals/copies the one-time token and SSR MCP template', async () => {
    const props = {
      workspaceSlug: 'alpha',
      mcpUrl: 'https://api.example/mcp/ws',
      mcpCommandTemplate: 'claude --header "Authorization: Bearer {{TOKEN}}" https://api.example/mcp/ws',
    }
    const view = render(<TokenManager {...props} initialTokens={[token()]} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New token' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Unsaved agent' } })
    fireEvent.change(screen.getByLabelText('Expires in (days, optional)'), {
      target: { value: '90' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Read-only' }))
    view.rerender(<TokenManager {...props} initialTokens={[token('Server token')]} />)
    expect(screen.getAllByText('Server token').length).toBe(2)
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Unsaved agent')
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({
      ok: true,
      value: {
        id: 'new',
        name: 'Unsaved agent',
        token: 'pk_test_secret',
        scopes: ['read'],
        expiresAt: null,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await waitFor(() => expect(screen.getByText('pk_test_secret')).toBeTruthy())
    expect(request).toHaveBeenLastCalledWith('createToken', {
      workspaceSlug: 'alpha',
      name: 'Unsaved agent',
      scope: 'read',
      expiry: '90',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('pk_test_secret'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'claude --header "Authorization: Bearer pk_test_secret" https://api.example/mcp/ws',
      ),
    )
    view.rerender(<TokenManager {...props} initialTokens={[token('Refreshed token')]} />)
    expect(screen.getByText('pk_test_secret')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('pk_test_secret')).toBeNull()
  })
  it('uses Effect Standard Schema to reject whitespace group names and fractional/out-of-range token expiry', async () => {
    const view = render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: '  ' } })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Create group' }) as HTMLButtonElement).disabled).toBe(true),
    )
    expect(screen.getByRole('alert').textContent).toContain('Group name is required')
    view.unmount()
    render(<TokenManager workspaceSlug='alpha' mcpUrl={null} initialTokens={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New token' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Agent' } })
    fireEvent.change(screen.getByLabelText('Expires in (days, optional)'), {
      target: { value: '1.5' },
    })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('whole number'))
    expect((screen.getByRole('button', { name: 'Create token' }) as HTMLButtonElement).disabled).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })
  it('requires token revoke confirmation and retains expected failure/retry controls', async () => {
    render(<TokenManager workspaceSlug='alpha' mcpUrl={null} initialTokens={[token()]} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({ ok: false, status: 403, message: 'Denied' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('Denied'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('revokeToken', {
        workspaceSlug: 'alpha',
        tokenId: 't1',
      }),
    )
  })
  it('refreshes connector rows without state copies and retains disconnect confirmation/failure/retry', async () => {
    const view = render(<ConnectorManager workspaceSlug='alpha' initialGrants={[grant()]} />)
    view.rerender(<ConnectorManager workspaceSlug='alpha' initialGrants={[grant('Refreshed Claude')]} />)
    expect(screen.getAllByText('Refreshed Claude').length).toBe(2)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[0])
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({ ok: false, status: 403, message: 'Denied' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('Denied'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith('disconnect', {
        workspaceSlug: 'alpha',
        connectorId: 'c1',
      }),
    )
  })
  it('preserves every guide step and copies the refreshed server URL', async () => {
    const view = render(<ConnectAgentGuide workspaceSlug='alpha' mcpUrl='https://api.example/mcp/first' />)
    view.rerender(<ConnectAgentGuide workspaceSlug='alpha' mcpUrl='https://api.example/mcp/second' />)
    expect(screen.getByText(/leave request headers empty/)).toBeTruthy()
    expect(screen.getByText(/approve the consent screen/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://api.example/mcp/second'))
  })
})
