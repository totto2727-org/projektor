import { describe, expect, it } from 'vite-plus/test'

import { actionFixture, formData } from '../planning/action-test-fixture'

const { createProject, updateDescription, archiveProject } = await import('./actions')

describe('project native forms invoke real shared commands', () => {
  it('creates a project with a blank optional description through the unchanged domain schema', async () => {
    const test = actionFixture()
    const result = await test.invoke(
      createProject,
      null,
      formData({ workspaceSlug: 'alpha', name: 'New project', key: 'NEW', description: '' }),
    )
    expect(result).toMatchObject({
      ok: true,
      value: { id: expect.any(String), name: 'New project', key: 'NEW', slug: 'new-project' },
    })
    expect(test.sqlite.prepare("SELECT name,key,description FROM projects WHERE key='NEW'").get()).toMatchObject({
      name: 'New project',
      key: 'NEW',
      description: '',
    })
    expect(test.transport).not.toHaveBeenCalled()
    expect(test.invalidated).toHaveBeenCalledTimes(1)
  })
  it('clears the description with an accepted empty string rather than unsupported null', async () => {
    const test = actionFixture()
    test.sqlite.exec("UPDATE projects SET description='Existing' WHERE id='p1'")
    expect(
      await test.invoke(
        updateDescription,
        null,
        formData({ workspaceSlug: 'alpha', projectId: 'p1', description: '' }),
      ),
    ).toEqual({ ok: true, value: { ok: true } })
    expect(test.sqlite.prepare("SELECT description FROM projects WHERE id='p1'").get()?.description).toBe('')
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('archives and restores after resolving the actual D1 project catalog', async () => {
    const test = actionFixture()
    expect(await test.invoke(archiveProject, { workspaceSlug: 'alpha', projectId: 'p1', archived: true })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare("SELECT archived_at FROM projects WHERE id='p1'").get()?.archived_at).toEqual(
      expect.any(Number),
    )
    expect(await test.invoke(archiveProject, { workspaceSlug: 'alpha', projectId: 'p1', archived: false })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare("SELECT archived_at FROM projects WHERE id='p1'").get()?.archived_at).toBeNull()
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('rejects a foreign project from real D1 before the mutation', async () => {
    const test = actionFixture()
    expect(
      await test.invoke(archiveProject, { workspaceSlug: 'alpha', projectId: 'foreign', archived: true }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(test.sqlite.prepare("SELECT archived_at FROM projects WHERE id='foreign'").get()?.archived_at).toBeNull()
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('rejects leading-digit project keys before execution', async () => {
    const test = actionFixture()
    await expect(
      test.invoke(
        createProject,
        null,
        formData({ workspaceSlug: 'alpha', name: 'Invalid key', key: '1BAD', description: '' }),
      ),
    ).rejects.toBeDefined()
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('preserves workspace-admin mutation authority even for a granted project member', async () => {
    const test = actionFixture()
    test.sqlite.exec(
      "UPDATE workspace_members SET role='member' WHERE user_id='u1'; INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Team',1); INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1); INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','p1','admin');",
    )
    expect(
      await test.invoke(
        updateDescription,
        null,
        formData({ workspaceSlug: 'alpha', projectId: 'p1', description: 'Denied' }),
      ),
    ).toMatchObject({ ok: false, status: 403 })
    expect(test.sqlite.prepare("SELECT description FROM projects WHERE id='p1'").get()?.description).toBeNull()
  })
  it('serializes a real duplicate-key conflict and invalidates without an API transport', async () => {
    const test = actionFixture()
    expect(
      await test.invoke(
        createProject,
        null,
        formData({ workspaceSlug: 'alpha', name: 'Duplicate', key: 'PROJ', description: '' }),
      ),
    ).toMatchObject({ ok: false, status: 409 })
    expect(test.invalidated).toHaveBeenCalledTimes(1)
    expect(test.transport).not.toHaveBeenCalled()
  })
})
