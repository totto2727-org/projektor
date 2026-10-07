import { describe, expect, it } from 'vite-plus/test'

import { actionFixture, formData } from './action-test-fixture'
import { calendarTimestamp } from './input-schemas'

const actions = await import('./actions')
const scope = { workspaceSlug: 'alpha', projectId: 'p1' }
const draft = {
  ...scope,
  name: ' Sprint ',
  goal: ' Goal ',
  start: '2026-10-04',
  end: '',
  startOffset: -540,
  endOffset: 0,
}
function fetchUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : input.toString()
}

const writes = (fixture: ReturnType<typeof actionFixture>) =>
  fixture.transport.mock.calls.filter(([, options]) => options?.method !== 'GET')
const reads = (fixture: ReturnType<typeof actionFixture>) =>
  fixture.transport.mock.calls
    .filter(([, options]) => options?.method === 'GET')
    .map(([url]) => new URL(url instanceof Request ? url.url : url.toString()).pathname)

function seedIssues(fixture: ReturnType<typeof actionFixture>, count: number, sprintId = 's1', projectId = 'p1') {
  const statement = fixture.sqlite.prepare(
    "INSERT INTO issues (id,workspace_id,project_id,number,title,created_by_id,created_at,updated_at,sprint_id) VALUES (?, 'w1', ?, ?, 'Task', 'u1', 1, 1, ?)",
  )
  for (let index = 0; index < count; index++) statement.run(`i${index}`, projectId, index + 1, sprintId)
}

describe('planning ServerFns with real D1 reads and unchanged API mutation contracts', () => {
  it('rejects missing scope and invalid offsets before authentication or mutation', async () => {
    const fixture = actionFixture(() => ({ id: 'created' }))
    const missingScope = formData(draft)
    missingScope.delete('workspaceSlug')
    await expect(fixture.invoke(actions.createSprint, null, missingScope)).rejects.toMatchObject({
      _tag: 'SchemaError',
    })
    await expect(
      fixture.invoke(actions.createSprint, null, formData({ ...draft, startOffset: 900 })),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(fixture.transport).not.toHaveBeenCalled()
  })
  it('creates through the fixed API contract with browser credentials and calendar offsets', async () => {
    const fixture = actionFixture(() => ({ id: 'created' }))
    expect(await fixture.invoke(actions.createSprint, null, formData(draft))).toEqual({
      ok: true,
      value: { id: 'created' },
    })
    const [url, options] = writes(fixture)[0]
    expect(url instanceof Request ? url.url : url.toString()).toBe('https://api.example/api/sprints')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(await new Response(options?.body).text())).toEqual({
      projectId: 'p1',
      name: 'Sprint',
      goal: 'Goal',
      startDate: calendarTimestamp(draft.start, -540),
    })
    expect(new Headers(options?.headers).get('x-workspace-slug')).toBe('alpha')
    expect(new Headers(options?.headers).get('cookie')).toBe('CF_Authorization=actual-user')
    expect(reads(fixture)).toEqual(['/auth/me'])
    expect(fixture.invalidated).toHaveBeenCalledTimes(1)
  })
  it('edits an actual sprint row and clears optional dates and goal via the unchanged PATCH', async () => {
    const fixture = actionFixture(() => ({ ok: true }))
    expect(
      await fixture.invoke(actions.editSprint, null, formData({ ...draft, sprintId: 's1', goal: '', start: '' })),
    ).toEqual({ ok: true, value: { ok: true } })
    expect(JSON.parse(await new Response(writes(fixture)[0][1]?.body).text())).toEqual({
      name: 'Sprint',
      goal: null,
      startDate: null,
      endDate: null,
    })
    expect(writes(fixture)[0][1]?.method).toBe('PATCH')
    expect(reads(fixture)).toEqual(['/auth/me'])
  })
  it.each(['planned', 'active', 'completed'] as const)(
    'changes status to %s after direct D1 lookup',
    async (status) => {
      const fixture = actionFixture(() => ({ ok: true }))
      expect(await fixture.invoke(actions.setSprintStatus, { ...scope, sprintId: 's1', status })).toEqual({
        ok: true,
        value: { ok: true },
      })
      expect(JSON.parse(await new Response(writes(fixture)[0][1]?.body).text())).toEqual({
        status,
      })
      expect(reads(fixture)).toEqual(['/auth/me'])
      expect(fixture.invalidated).toHaveBeenCalledTimes(1)
    },
  )
  it('archives through DELETE after a matching scoped database lookup', async () => {
    const fixture = actionFixture(() => ({ ok: true }))
    expect(await fixture.invoke(actions.archiveSprint, { ...scope, sprintId: 's1' })).toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(writes(fixture)[0][1]?.method).toBe('DELETE')
    expect(fetchUrl(writes(fixture)[0][0])).toContain('/api/sprints/s1')
    expect(reads(fixture)).toEqual(['/auth/me'])
  })
  it('rejects foreign selectors, workspace rows, project rows, missing rows and cross-origin callers before mutation', async () => {
    const selector = actionFixture(() => ({ id: 'created' }))
    expect(
      await selector.invoke(actions.createSprint, null, formData({ ...draft, workspaceSlug: 'beta' })),
    ).toMatchObject({ ok: false, status: 403 })
    expect(writes(selector)).toEqual([])
    for (const sprintId of ['foreign-sprint', 'missing']) {
      const fixture = actionFixture(() => {
        throw new Error('Must not mutate foreign sprint')
      })
      expect(await fixture.invoke(actions.archiveSprint, { ...scope, sprintId })).toMatchObject({
        ok: false,
        status: 404,
      })
      expect(writes(fixture)).toEqual([])
    }
    const foreignProject = actionFixture(() => {
      throw new Error('Must not mutate foreign project sprint')
    })
    foreignProject.sqlite.exec("UPDATE sprints SET project_id='other' WHERE id='s1'")
    expect(await foreignProject.invoke(actions.archiveSprint, { ...scope, sprintId: 's1' })).toMatchObject({
      ok: false,
      status: 404,
    })
    expect(writes(foreignProject)).toEqual([])
    const origin = actionFixture(() => ({ id: 'created' }), 'https://foreign.example')
    expect(await origin.invoke(actions.createSprint, null, formData(draft))).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(origin.transport).not.toHaveBeenCalled()
    expect(origin.invalidated).toHaveBeenCalledTimes(1)
  })
  it('checks real source, target and selected issue rows before moving through POST', async () => {
    const fixture = actionFixture(() => ({ ok: true, count: 8 }))
    seedIssues(fixture, 8)
    const issueIds = Array.from({ length: 8 }, (_, index) => `i${index}`)
    expect(
      await fixture.invoke(actions.moveSprintIssues, {
        ...scope,
        sprintId: 's1',
        targetId: 's2',
        issueIds,
      }),
    ).toEqual({ ok: true, value: { ok: true, count: 8 } })
    expect(fetchUrl(writes(fixture)[0][0])).toContain('/api/sprints/s2/move-issues')
    expect(JSON.parse(await new Response(writes(fixture)[0][1]?.body).text())).toEqual({
      issueIds,
    })
    expect(reads(fixture)).toEqual(['/auth/me'])
  })
  it.each(['stale', 'foreign-project', 'missing', 'completed-target'])(
    'rejects %s issue movement without a write',
    async (scenario) => {
      const fixture = actionFixture(() => {
        throw new Error('Must not write invalid movement')
      })
      if (scenario !== 'missing')
        seedIssues(fixture, 1, scenario === 'stale' ? 's2' : 's1', scenario === 'foreign-project' ? 'other' : 'p1')
      if (scenario === 'completed-target') fixture.sqlite.exec("UPDATE sprints SET status='completed' WHERE id='s2'")
      expect(
        await fixture.invoke(actions.moveSprintIssues, {
          ...scope,
          sprintId: 's1',
          targetId: 's2',
          issueIds: ['i0'],
        }),
      ).toMatchObject({ ok: false, status: 404 })
      expect(writes(fixture)).toEqual([])
    },
  )
  it('maps database failure to a safe action result and still invalidates', async () => {
    const fixture = actionFixture(() => {
      throw new Error('Must not mutate after a read failure')
    })
    fixture.sqlite.exec('DROP TABLE sprints')
    expect(await fixture.invoke(actions.archiveSprint, { ...scope, sprintId: 's1' })).toMatchObject({
      ok: false,
      status: 500,
      message: 'Unable to load project data.',
    })
    expect(writes(fixture)).toEqual([])
    expect(fixture.invalidated).toHaveBeenCalledTimes(1)
  })
  it('keeps concrete HTTP response decoding on the unchanged API mutation path', async () => {
    const fixture = actionFixture(() => new Response('not-json', { headers: { 'content-type': 'application/json' } }))
    expect(await fixture.invoke(actions.archiveSprint, { ...scope, sprintId: 's1' })).toMatchObject({
      ok: false,
      status: 502,
    })
    expect(writes(fixture)).toHaveLength(1)
  })
  it('validates whitespace-only names and reversed dates before any HTTP', async () => {
    const fixture = actionFixture(() => ({ id: 'created' }))
    await expect(fixture.invoke(actions.createSprint, null, formData({ ...draft, name: '  ' }))).rejects.toMatchObject({
      _tag: 'SchemaError',
    })
    await expect(
      fixture.invoke(actions.editSprint, null, formData({ ...draft, sprintId: 's1', end: '2026-10-01' })),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(fixture.transport).not.toHaveBeenCalled()
  })
})
