// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Iterable } from 'effect'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'

import { ConnectAgentGuide } from './connect-agent-guide.tsx'
import { ConnectorManager } from './connector-manager.tsx'
import { GroupManager } from './group-manager.tsx'
import { TokenManager } from './token-manager.tsx'
import type { ConnectorGrant, GroupData, Token } from './types.ts'

const request = vi.hoisted(() => vi.fn<(operation: string, input: unknown) => unknown>())
const nativeSubmitted = vi.hoisted(() => vi.fn<(operation: string, previous: unknown, data: FormData) => void>())
vi.mock('./actions', () => ({
  addGroupMember: (previous: unknown, data: FormData) => {
    nativeSubmitted('addMember', previous, data)
    return request('addMember', Object.fromEntries(data))
  },
  createGroup: (previous: unknown, data: FormData) => {
    nativeSubmitted('createGroup', previous, data)
    return request('createGroup', Object.fromEntries(data))
  },
  createGroupGrant: (previous: unknown, data: FormData) => {
    nativeSubmitted('createGrant', previous, data)
    return request('setGrant', Object.fromEntries(data))
  },
  createToken: (previous: unknown, data: FormData) => {
    nativeSubmitted('createToken', previous, data)
    return request('createToken', Object.fromEntries(data))
  },
  deleteGroup: (input: unknown) => request('deleteGroup', input),
  describeGroup: (previous: unknown, data: FormData) => {
    nativeSubmitted('describeGroup', previous, data)
    return request('describeGroup', Object.fromEntries(data))
  },
  disconnectConnector: (input: unknown) => request('disconnect', input),
  removeGroupGrant: (input: unknown) => request('removeGrant', input),
  removeGroupMember: (input: unknown) => request('removeMember', input),
  renameGroup: (previous: unknown, data: FormData) => {
    nativeSubmitted('renameGroup', previous, data)
    return request('renameGroup', Object.fromEntries(data))
  },
  revokeToken: (input: unknown) => request('revokeToken', input),
  setGroupGrant: (input: unknown) => request('setGrant', input),
}))
const groupData = (): GroupData => ({
  details: [
    {
      description: 'Original',
      grantCount: 1,
      grants: [{ projectId: 'p1', projectKey: 'ONE', projectName: 'Project One', role: 'viewer' }],
      id: 'g1',
      memberCount: 1,
      members: [{ email: 'alice@example.test', name: 'Alice', userId: 'u1' }],
      name: 'Team',
    },
  ],
  groups: [{ description: 'Original', grantCount: 1, id: 'g1', memberCount: 1, name: 'Team' }],
  memberGroups: [{ groups: [{ id: 'g1', name: 'Team' }], userId: 'u1' }],
  members: [
    { email: 'alice@example.test', id: 'u1', name: 'Alice', role: 'member' },
    { email: 'bob@example.test', id: 'u2', name: 'Bob', role: 'member' },
    { email: 'admin@example.test', id: 'admin', name: 'Admin', role: 'admin' },
  ],
  projects: [
    { id: 'p1', key: 'ONE', name: 'Project One', workspace_slug: 'alpha' },
    { id: 'p2', key: 'TWO', name: 'Project Two', workspace_slug: 'alpha' },
  ],
  role: 'admin',
})
const token = (name = 'Agent'): Token => ({
  createdAt: 1,
  expiresAt: JSON_NULL,
  id: 't1',
  lastUsedAt: JSON_NULL,
  name,
  scopes: '["read","write"]',
})
const grant = (client = 'Claude'): ConnectorGrant => ({
  client,
  clientId: 'client',
  expiresAt: 2_000_000_000,
  grantedAt: 1,
  id: 'c1',
  scopes: ['projektor:read', 'projektor:write'],
})
const groupScope = { groupId: 'g1', workspaceSlug: 'alpha' }
const writeText = vi.fn<Clipboard['writeText']>(async () => {
  // Record the copied text without writing to the host clipboard.
})

const submitNewGroup = function submitNewGroup(name: string): void {
  fireEvent.change(screen.getByLabelText('New group name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
}

describe('original settings controls with TanStack schemas and semantic ServerFns', () => {
  afterEach(cleanup)

  beforeEach(() => {
    request.mockReset()
    nativeSubmitted.mockReset()
    writeText.mockClear()
    request.mockResolvedValue({ ok: true, value: { ok: true } })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  test('releases delayed member-removal failures and preserves editor drafts through canonical refresh', async () => {
    const pending = Promise.withResolvers<unknown>()
    request.mockReturnValueOnce(pending.promise)
    const view = render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Team' })[0])
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Unsaved rename' } })
    fireEvent.click(screen.getByLabelText('Remove Alice'))
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'New draft while pending' } })
    const next = groupData()
    next.details[0].name = 'Canonical name'
    view.rerender(<GroupManager workspaceSlug='alpha' initialData={next} />)
    await act(async () => {
      pending.reject(new Error('Removal unavailable'))
    })
    expect(screen.getByRole('alert').textContent).toContain('Removal unavailable')
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByLabelText('Group name')).toHaveProperty('value', 'Unsaved rename')
    expect(screen.getByLabelText('New group name')).toHaveProperty('value', 'New draft while pending')
    request.mockResolvedValueOnce({ ok: true, value: { ok: true } })
    await act(async () => fireEvent.click(screen.getByLabelText('Remove Alice')))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(false)
  })

  test('keeps native group creation drafts after typed failure and clears them only after success', async () => {
    expect.hasAssertions()
    request.mockResolvedValueOnce({ message: 'Group conflict', ok: false, status: 409 })
    render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    submitNewGroup('Retry team')
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Group conflict')
    })
    expect(screen.getByLabelText<HTMLInputElement>('New group name').value).toBe('Retry team')
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('New group name').value).toBe('')
    })
  })

  test('never fetches primary lists/details and preserves all active group form drafts on canonical refresh', () => {
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
    next.details[0].members = [{ email: 'bob@example.test', name: 'Bob', userId: 'u2' }]
    view.rerender(<GroupManager workspaceSlug='alpha' initialData={next} />)
    expect(screen.getAllByRole('button', { name: 'Server Team' })).toHaveLength(2)
    expect(screen.getByLabelText('Remove Bob')).toBeInstanceOf(Element)
    expect(screen.queryByLabelText('Remove Alice')).toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>('Group name').value).toBe('Unsaved rename')
    expect(screen.getByLabelText<HTMLTextAreaElement>('Description').value).toBe('Unsaved description')
    expect(screen.getByLabelText<HTMLInputElement>('New group name').value).toBe('Unsaved new group')
    expect(request).not.toHaveBeenCalled()
  })

  test('submits original rename/description/member/grant controls through typed semantic actions', async () => {
    expect.hasAssertions()
    render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Team' })[0])
    const submitted = async (operation: string, fields: object): Promise<void> => {
      await waitFor(() => {
        expect(request).toHaveBeenLastCalledWith(operation, { ...groupScope, ...fields })
      })
      await waitFor(() => {
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close' }).disabled).toBe(false)
      })
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
    Iterable.forEach(['renameGroup', 'describeGroup', 'addMember', 'createGrant'], (operation) => {
      expect(nativeSubmitted).toHaveBeenCalledWith(operation, JSON_NULL, expect.any(FormData))
    })
  })

  test('creates groups without fake aggregate DTOs and requires deletion confirmation', async () => {
    expect.hasAssertions()
    render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    submitNewGroup('New team')
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('createGroup', {
        name: 'New team',
        workspaceSlug: 'alpha',
      })
    })
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('New group name').value).toBe('')
    })
    const count = request.mock.calls.length
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(request.mock.calls).toHaveLength(count)
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => {
      expect(request).toHaveBeenLastCalledWith('deleteGroup', groupScope)
    })
  })

  test('retains accessible tabs, member chips/pending/admin bypass and read-only groups', () => {
    const data = groupData()
    const view = render(<GroupManager workspaceSlug='alpha' initialData={data} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Groups' })).toBeInstanceOf(Element)
    expect(screen.getByText(/Groups grant members access to projects/u)).toBeInstanceOf(Element)
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
    expect(screen.getAllByText('Pending: no access')).toHaveLength(2)
    expect(screen.getAllByText('All projects (bypasses groups)')).toHaveLength(2)
    view.rerender(<GroupManager workspaceSlug='alpha' initialData={{ ...data, role: 'viewer', details: [] }} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Groups' })).toBeInstanceOf(Element)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Team' })).toBeNull()
  })

  test('preserves token form fields on refresh and reveals/copies the one-time token and SSR MCP template', async () => {
    expect.hasAssertions()
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
    expect(screen.getAllByText('Server token')).toHaveLength(2)
    expect(screen.getByLabelText<HTMLInputElement>('Name *').value).toBe('Unsaved agent')
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({
      ok: true,
      value: {
        expiresAt: JSON_NULL,
        id: 'new',
        name: 'Unsaved agent',
        scopes: ['read'],
        token: 'pk_test_secret',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await waitFor(() => {
      expect(screen.getByText('pk_test_secret')).toBeInstanceOf(Element)
    })
    expect(request).toHaveBeenLastCalledWith('createToken', {
      expiry: '90',
      name: 'Unsaved agent',
      scope: 'read',
      workspaceSlug: 'alpha',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('pk_test_secret')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        'claude --header "Authorization: Bearer pk_test_secret" https://api.example/mcp/ws',
      )
    })
    view.rerender(<TokenManager {...props} initialTokens={[token('Refreshed token')]} />)
    expect(screen.getByText('pk_test_secret')).toBeInstanceOf(Element)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('pk_test_secret')).toBeNull()
  })

  test('uses Effect Standard Schema to reject whitespace group names and fractional/out-of-range token expiry', async () => {
    expect.hasAssertions()
    const view = render(<GroupManager workspaceSlug='alpha' initialData={groupData()} />)
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: '  ' } })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create group' }).disabled).toBe(true)
    })
    expect(screen.getByRole('alert').textContent).toContain('Group name is required')
    view.unmount()
    render(<TokenManager workspaceSlug='alpha' mcpUrl={JSON_NULL} initialTokens={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New token' }))
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Agent' } })
    fireEvent.change(screen.getByLabelText('Expires in (days, optional)'), {
      target: { value: '1.5' },
    })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('whole number')
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create token' }).disabled).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  test('requires token revoke confirmation and retains expected failure/retry controls', async () => {
    expect.hasAssertions()
    render(<TokenManager workspaceSlug='alpha' mcpUrl={JSON_NULL} initialTokens={[token()]} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0])
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({ message: 'Denied', ok: false, status: 403 })
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => {
      expect(screen.getAllByRole('alert')[0].textContent).toContain('Denied')
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => {
      expect(request).toHaveBeenLastCalledWith('revokeToken', {
        tokenId: 't1',
        workspaceSlug: 'alpha',
      })
    })
  })

  test('refreshes connector rows without state copies and retains disconnect confirmation/failure/retry', async () => {
    expect.hasAssertions()
    const view = render(<ConnectorManager workspaceSlug='alpha' initialGrants={[grant()]} />)
    view.rerender(<ConnectorManager workspaceSlug='alpha' initialGrants={[grant('Refreshed Claude')]} />)
    expect(screen.getAllByText('Refreshed Claude')).toHaveLength(2)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[0])
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({ message: 'Denied', ok: false, status: 403 })
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => {
      expect(screen.getAllByRole('alert')[0].textContent).toContain('Denied')
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0])
    await waitFor(() => {
      expect(request).toHaveBeenLastCalledWith('disconnect', {
        connectorId: 'c1',
        workspaceSlug: 'alpha',
      })
    })
  })

  test('preserves every guide step and copies the refreshed server URL', async () => {
    expect.hasAssertions()
    const view = render(<ConnectAgentGuide workspaceSlug='alpha' mcpUrl='https://api.example/mcp/first' />)
    view.rerender(<ConnectAgentGuide workspaceSlug='alpha' mcpUrl='https://api.example/mcp/second' />)
    expect(screen.getByText(/leave request headers empty/u)).toBeInstanceOf(Element)
    expect(screen.getByText(/approve the consent screen/u)).toBeInstanceOf(Element)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://api.example/mcp/second')
    })
  })
})
