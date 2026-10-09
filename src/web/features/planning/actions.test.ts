import { describe, expect, it } from 'vite-plus/test'

import { actionFixture, formData, planningIds } from './action-test-fixture'
import { calendarTimestamp } from './input-schemas'

const actions = await import('./actions')
const scope = { workspaceSlug: 'alpha', projectId: planningIds.project }
const draft = {
  ...scope,
  name: ' Sprint ',
  goal: ' Goal ',
  start: '2026-10-04',
  end: '',
  startOffset: -540,
  endOffset: 0,
}
function fixture(origin = 'https://front.example') {
  const test = actionFixture(undefined, origin)
  test.sqlite.exec(`
    INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('${planningIds.project}','w1','Planning','PLAN','planning',1,1);
    INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES
      ('${planningIds.source}','w1','${planningIds.project}','Sprint','planned',1,1),
      ('${planningIds.target}','w1','${planningIds.project}','Next sprint','planned',2,2);
  `)
  return test
}
function seedIssues(
  test: ReturnType<typeof fixture>,
  count: number,
  sprintId = planningIds.source,
  projectId = planningIds.project,
) {
  const ids = Array.from({ length: count }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  const insert = test.sqlite.prepare(
    "INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at,sprint_id) VALUES (?, 'w1', ?, ?, 'Task', 'u1', 1, 1, ?)",
  )
  for (const [index, id] of ids.entries()) insert.run(id, projectId, index + 1, sprintId)
  return ids
}

describe('planning ServerFns with real D1 authentication and shared commands', () => {
  it('rejects missing scope and invalid offsets before authentication or mutation', async () => {
    const test = fixture()
    const missingScope = formData(draft)
    missingScope.delete('workspaceSlug')
    await expect(test.invoke(actions.createSprint, null, missingScope)).rejects.toMatchObject({ _tag: 'SchemaError' })
    await expect(
      test.invoke(actions.createSprint, null, formData({ ...draft, startOffset: 900 })),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(test.sqlite.prepare('SELECT count(*) AS count FROM sprints').get()?.count).toBe(5)
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('creates via the shared command with browser calendar offsets and normalized fields', async () => {
    const test = fixture()
    const result = await test.invoke(actions.createSprint, null, formData(draft))
    expect(result).toMatchObject({ ok: true, value: { id: expect.any(String) } })
    const row = test.sqlite
      .prepare("SELECT name,goal,start_date,end_date,project_id FROM sprints WHERE name='Sprint' AND goal='Goal'")
      .get()
    expect(row).toMatchObject({
      name: 'Sprint',
      goal: 'Goal',
      start_date: calendarTimestamp(draft.start, -540),
      end_date: null,
      project_id: scope.projectId,
    })
    expect(test.transport).not.toHaveBeenCalled()
    expect(test.invalidated).toHaveBeenCalledTimes(1)
  })
  it('edits the actual sprint and clears optional dates and goal', async () => {
    const test = fixture()
    expect(
      await test.invoke(
        actions.editSprint,
        null,
        formData({ ...draft, sprintId: planningIds.source, goal: '', start: '' }),
      ),
    ).toEqual({ ok: true, value: { ok: true } })
    expect(
      test.sqlite.prepare('SELECT name,goal,start_date,end_date FROM sprints WHERE id=?').get(planningIds.source),
    ).toMatchObject({ name: 'Sprint', goal: null, start_date: null, end_date: null })
    expect(test.transport).not.toHaveBeenCalled()
  })
  it.each(['planned', 'active', 'completed'] as const)('changes status to %s after scoped lookup', async (status) => {
    const test = fixture()
    expect(await test.invoke(actions.setSprintStatus, { ...scope, sprintId: planningIds.source, status })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare('SELECT status FROM sprints WHERE id=?').get(planningIds.source)?.status).toBe(status)
    expect(test.transport).not.toHaveBeenCalled()
    expect(test.invalidated).toHaveBeenCalledTimes(1)
  })
  it('deletes the matching scoped sprint and unassigns its issues', async () => {
    const test = fixture()
    const [id] = seedIssues(test, 1)
    expect(await test.invoke(actions.archiveSprint, { ...scope, sprintId: planningIds.source })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare('SELECT id FROM sprints WHERE id=?').get(planningIds.source)).toBeUndefined()
    expect(test.sqlite.prepare('SELECT sprint_id FROM issues WHERE id=?').get(id)?.sprint_id).toBeNull()
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('rejects foreign selectors, workspace rows, project rows, missing rows and cross-origin callers without mutation', async () => {
    const selector = fixture()
    expect(
      await selector.invoke(actions.createSprint, null, formData({ ...draft, workspaceSlug: 'beta' })),
    ).toMatchObject({ ok: false, status: 403 })
    for (const sprintId of ['foreign-sprint', 'missing', 's1']) {
      const test = fixture()
      expect(await test.invoke(actions.archiveSprint, { ...scope, sprintId })).toMatchObject({ ok: false, status: 404 })
      expect(test.sqlite.prepare('SELECT id FROM sprints WHERE id=?').get(planningIds.source)).toBeDefined()
      expect(test.transport).not.toHaveBeenCalled()
    }
    const origin = fixture('https://foreign.example')
    expect(await origin.invoke(actions.createSprint, null, formData(draft))).toMatchObject({ ok: false, status: 403 })
    expect(origin.invalidated).toHaveBeenCalledTimes(1)
    expect(origin.transport).not.toHaveBeenCalled()
  })
  it('checks source, target and issue rows before moving deduplicated issues', async () => {
    const test = fixture()
    const issueIds = seedIssues(test, 8)
    expect(
      await test.invoke(actions.moveSprintIssues, {
        ...scope,
        sprintId: planningIds.source,
        targetId: planningIds.target,
        issueIds: [...issueIds, issueIds[0]],
      }),
    ).toEqual({ ok: true, value: { ok: true, count: 8 } })
    expect(
      test.sqlite.prepare('SELECT count(*) AS count FROM issues WHERE sprint_id=?').get(planningIds.target)?.count,
    ).toBe(8)
    expect(test.transport).not.toHaveBeenCalled()
  })
  it.each(['stale', 'foreign-project', 'missing', 'completed-target'])(
    'rejects %s issue movement without a write',
    async (scenario) => {
      const test = fixture()
      const issueIds =
        scenario === 'missing'
          ? ['10000000-0000-4000-8000-000000000000']
          : seedIssues(
              test,
              1,
              scenario === 'stale' ? planningIds.target : planningIds.source,
              scenario === 'foreign-project' ? 'other' : planningIds.project,
            )
      if (scenario === 'completed-target')
        test.sqlite.prepare("UPDATE sprints SET status='completed' WHERE id=?").run(planningIds.target)
      expect(
        await test.invoke(actions.moveSprintIssues, {
          ...scope,
          sprintId: planningIds.source,
          targetId: planningIds.target,
          issueIds,
        }),
      ).toMatchObject({ ok: false, status: 404 })
      if (scenario !== 'missing')
        expect(test.sqlite.prepare('SELECT sprint_id FROM issues WHERE id=?').get(issueIds[0])?.sprint_id).toBe(
          scenario === 'stale' ? planningIds.target : planningIds.source,
        )
      expect(test.transport).not.toHaveBeenCalled()
    },
  )
  it('maps database read failure safely and still invalidates', async () => {
    const test = fixture()
    test.sqlite.exec('DROP TABLE sprints')
    expect(await test.invoke(actions.archiveSprint, { ...scope, sprintId: planningIds.source })).toMatchObject({
      ok: false,
      status: 500,
      message: 'Unable to load project data.',
    })
    expect(test.transport).not.toHaveBeenCalled()
    expect(test.invalidated).toHaveBeenCalledTimes(1)
  })
  it('enforces real command write authorization for a granted viewer', async () => {
    const test = fixture()
    test.sqlite.exec(
      `UPDATE workspace_members SET role='member' WHERE user_id='u1'; INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Team',1); INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1); INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','${planningIds.project}','viewer');`,
    )
    expect(await test.invoke(actions.archiveSprint, { ...scope, sprintId: planningIds.source })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(test.sqlite.prepare('SELECT id FROM sprints WHERE id=?').get(planningIds.source)).toBeDefined()
    expect(test.transport).not.toHaveBeenCalled()
  })
  it('validates whitespace-only names and reversed dates before execution', async () => {
    const test = fixture()
    await expect(test.invoke(actions.createSprint, null, formData({ ...draft, name: '  ' }))).rejects.toMatchObject({
      _tag: 'SchemaError',
    })
    await expect(
      test.invoke(actions.editSprint, null, formData({ ...draft, sprintId: planningIds.source, end: '2026-10-01' })),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(test.transport).not.toHaveBeenCalled()
  })
})
