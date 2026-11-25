import { Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { runInOrder } from '#tests/run-effect.ts'

import { actionFixture, formData, planningIds } from './action-test-fixture.ts'
import { calendarTimestamp } from './input-schemas.ts'

const actions = await import('./actions.ts')
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
const fixture = function fixture(origin = 'https://front.example') {
  const testFixture = actionFixture(undefined, origin)
  testFixture.sqlite.exec(`
    INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('${planningIds.project}','w1','Planning','PLAN','planning',1,1);
    INSERT INTO sprints (id,workspace_id,project_id,name,status,created_at,updated_at) VALUES
      ('${planningIds.source}','w1','${planningIds.project}','Sprint','planned',1,1),
      ('${planningIds.target}','w1','${planningIds.project}','Next sprint','planned',2,2);
  `)
  return testFixture
}
const seedIssues = function seedIssues(
  testFixture: ReturnType<typeof fixture>,
  count: number,
  sprintId = planningIds.source,
  projectId = planningIds.project,
): string[] {
  const ids = Array.from(
    { length: count },
    (_value, index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  )
  const insert = testFixture.sqlite.prepare(
    "INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at,sprint_id) VALUES (?, 'w1', ?, ?, 'Task', 'u1', 1, 1, ?)",
  )
  Iterable.forEach(ids.entries(), ([index, id]) => {
    insert.run(id, projectId, index + 1, sprintId)
  })
  return ids
}

describe('planning ServerFns with real D1 authentication and shared commands', () => {
  test('rejects missing scope and invalid offsets before authentication or mutation', async () => {
    const testFixture = fixture()
    const missingScope = formData(draft)
    missingScope.delete('workspaceSlug')
    await expect(testFixture.invoke(actions.createSprint, null, missingScope)).rejects.toMatchObject({
      _tag: 'SchemaError',
    })
    await expect(
      testFixture.invoke(actions.createSprint, null, formData({ ...draft, startOffset: 900 })),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(testFixture.sqlite.prepare('SELECT count(*) AS count FROM sprints').get()?.count).toBe(5)
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('creates via the shared command with browser calendar offsets and normalized fields', async () => {
    const testFixture = fixture()
    const result = await testFixture.invoke(actions.createSprint, null, formData(draft))
    expect(result).toMatchObject({ ok: true, value: { id: expect.any(String) } })
    const row = testFixture.sqlite
      .prepare("SELECT name,goal,start_date,end_date,project_id FROM sprints WHERE name='Sprint' AND goal='Goal'")
      .get()
    expect(row).toMatchObject({
      name: 'Sprint',
      goal: 'Goal',
      start_date: calendarTimestamp(draft.start, -540),
      end_date: null,
      project_id: scope.projectId,
    })
    expect(testFixture.transport).not.toHaveBeenCalled()
    expect(testFixture.invalidated).toHaveBeenCalledOnce()
  })

  test('edits the actual sprint and clears optional dates and goal', async () => {
    const testFixture = fixture()
    await expect(
      testFixture.invoke(
        actions.editSprint,
        null,
        formData({ ...draft, sprintId: planningIds.source, goal: '', start: '' }),
      ),
    ).resolves.toStrictEqual({ ok: true, value: { ok: true } })
    expect(
      testFixture.sqlite
        .prepare('SELECT name,goal,start_date,end_date FROM sprints WHERE id=?')
        .get(planningIds.source),
    ).toMatchObject({ end_date: null, goal: null, name: 'Sprint', start_date: null })
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test.each(['planned', 'active', 'completed'] as const)('changes status to %s after scoped lookup', async (status) => {
    const testFixture = fixture()
    await expect(
      testFixture.invoke(actions.setSprintStatus, { ...scope, sprintId: planningIds.source, status }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    expect(testFixture.sqlite.prepare('SELECT status FROM sprints WHERE id=?').get(planningIds.source)?.status).toBe(
      status,
    )
    expect(testFixture.transport).not.toHaveBeenCalled()
    expect(testFixture.invalidated).toHaveBeenCalledOnce()
  })

  test('deletes the matching scoped sprint and unassigns its issues', async () => {
    const testFixture = fixture()
    const [id] = seedIssues(testFixture, 1)
    await expect(
      testFixture.invoke(actions.archiveSprint, { ...scope, sprintId: planningIds.source }),
    ).resolves.toStrictEqual({
      ok: true,
      value: { ok: true },
    })
    expect(testFixture.sqlite.prepare('SELECT id FROM sprints WHERE id=?').get(planningIds.source)).toBeUndefined()
    expect(testFixture.sqlite.prepare('SELECT sprint_id FROM issues WHERE id=?').get(id)?.sprint_id).toBeNull()
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('rejects foreign selectors, workspace rows, project rows, missing rows and cross-origin callers without mutation', async () => {
    expect.hasAssertions()
    const selector = fixture()
    await expect(
      selector.invoke(actions.createSprint, null, formData({ ...draft, workspaceSlug: 'beta' })),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    await runInOrder(['foreign-sprint', 'missing', 's1'], async (sprintId): Promise<void> => {
      const testFixture = fixture()
      await expect(testFixture.invoke(actions.archiveSprint, { ...scope, sprintId })).resolves.toMatchObject({
        ok: false,
        status: 404,
      })
      expect(testFixture.sqlite.prepare('SELECT id FROM sprints WHERE id=?').get(planningIds.source)).toBeDefined()
      expect(testFixture.transport).not.toHaveBeenCalled()
    })
    const origin = fixture('https://foreign.example')
    await expect(origin.invoke(actions.createSprint, null, formData(draft))).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    expect(origin.invalidated).toHaveBeenCalledOnce()
    expect(origin.transport).not.toHaveBeenCalled()
  })

  test('checks source, target and issue rows before moving deduplicated issues', async () => {
    const testFixture = fixture()
    const issueIds = seedIssues(testFixture, 8)
    await expect(
      testFixture.invoke(actions.moveSprintIssues, {
        ...scope,
        sprintId: planningIds.source,
        targetId: planningIds.target,
        issueIds: [...issueIds, issueIds[0]],
      }),
    ).resolves.toStrictEqual({ ok: true, value: { count: 8, ok: true } })
    expect(
      testFixture.sqlite.prepare('SELECT count(*) AS count FROM issues WHERE sprint_id=?').get(planningIds.target)
        ?.count,
    ).toBe(8)
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test.each(['stale', 'foreign-project', 'missing', 'completed-target'])(
    'rejects %s issue movement without a write',
    async (scenario) => {
      const testFixture = fixture()
      const issueIds =
        scenario === 'missing'
          ? ['10000000-0000-4000-8000-000000000000']
          : seedIssues(
              testFixture,
              1,
              scenario === 'stale' ? planningIds.target : planningIds.source,
              scenario === 'foreign-project' ? 'other' : planningIds.project,
            )
      if (scenario === 'completed-target') {
        testFixture.sqlite.prepare("UPDATE sprints SET status='completed' WHERE id=?").run(planningIds.target)
      }
      await expect(
        testFixture.invoke(actions.moveSprintIssues, {
          ...scope,
          sprintId: planningIds.source,
          targetId: planningIds.target,
          issueIds,
        }),
      ).resolves.toMatchObject({ ok: false, status: 404 })
      if (scenario !== 'missing') {
        expect(testFixture.sqlite.prepare('SELECT sprint_id FROM issues WHERE id=?').get(issueIds[0])?.sprint_id).toBe(
          scenario === 'stale' ? planningIds.target : planningIds.source,
        )
      }
      expect(testFixture.transport).not.toHaveBeenCalled()
    },
  )

  test('maps database read failure safely and still invalidates', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec('DROP TABLE sprints')
    await expect(
      testFixture.invoke(actions.archiveSprint, { ...scope, sprintId: planningIds.source }),
    ).resolves.toMatchObject({
      message: 'An unexpected error occurred.',
      ok: false,
      status: 500,
    })
    expect(testFixture.transport).not.toHaveBeenCalled()
    expect(testFixture.invalidated).toHaveBeenCalledOnce()
  })

  test('enforces real command write authorization for a granted viewer', async () => {
    const testFixture = fixture()
    testFixture.sqlite.exec(
      `UPDATE workspace_members SET role='member' WHERE user_id='u1'; INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Team',1); INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1); INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','${planningIds.project}','viewer');`,
    )
    await expect(
      testFixture.invoke(actions.archiveSprint, { ...scope, sprintId: planningIds.source }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    expect(testFixture.sqlite.prepare('SELECT id FROM sprints WHERE id=?').get(planningIds.source)).toBeDefined()
    expect(testFixture.transport).not.toHaveBeenCalled()
  })

  test('validates whitespace-only names and reversed dates before execution', async () => {
    const testFixture = fixture()
    await expect(
      testFixture.invoke(actions.createSprint, null, formData({ ...draft, name: '  ' })),
    ).rejects.toMatchObject({
      _tag: 'SchemaError',
    })
    await expect(
      testFixture.invoke(
        actions.editSprint,
        null,
        formData({ ...draft, sprintId: planningIds.source, end: '2026-10-01' }),
      ),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(testFixture.transport).not.toHaveBeenCalled()
  })
})
