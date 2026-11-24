import { Predicate } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { actionFixture, formData, planningIds } from '@/features/planning/action-test-fixture.ts'

const actions = await import('./actions.ts')
const scope = { workspaceSlug: 'alpha', projectId: planningIds.project }
const fixture = function fixture(origin = 'https://front.example') {
  const test = actionFixture(undefined, origin)
  test.sqlite.exec(`
    INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('${scope.projectId}','w1','Feedback','FEED','feedback',1,1);
    INSERT INTO feedback_sources (id,token_hash,workspace_id,project_id,name,created_by,created_at) VALUES ('source','initial-hash','w1','${scope.projectId}','Existing','u1',1);
    INSERT INTO feedback (id,source_id,workspace_id,project_id,body,created_at) VALUES
      ('feedback','source','w1','${scope.projectId}','Please improve search',1),
      ('feedback2','source','w1','${scope.projectId}','Please improve navigation',1);
  `)
  return test
}

describe('feedback concrete ServerFn shared commands', () => {
  test('parses original origins form and persists only known source configuration fields', async () => {
    const test = fixture()
    await expect(
      test.invoke(
        actions.createFeedbackSource,
        null,
        formData({
          ...scope,
          name: ' Customers ',
          description: ' Notes ',
          origins: 'https://one.test\nhttps://two.test, ',
        }),
      ),
    ).resolves.toEqual({ ok: true, value: { id: expect.any(String), token: expect.stringMatching(/^fbk_/u) } })
    expect(
      test.sqlite
        .prepare("SELECT name,description,allowed_origins,created_by FROM feedback_sources WHERE name='Customers'")
        .get(),
    ).toMatchObject({
      name: 'Customers',
      description: 'Notes',
      allowed_origins: '["https://one.test","https://two.test"]',
      created_by: 'u1',
    })
    expect(test.invalidated).toHaveBeenCalledOnce()
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('rejects an inaccessible explicit project before mutation', async () => {
    const test = fixture()
    await expect(
      test.invoke(actions.markFeedbackReviewed, { ...scope, projectId: 'foreign', feedbackId: 'feedback' }),
    ).resolves.toMatchObject({ ok: false, status: 404 })
    expect(test.sqlite.prepare("SELECT status FROM feedback WHERE id='feedback'").get()?.status).toBe('new')
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('rejects cross-origin Feedback mutations before backend work', async () => {
    const test = fixture('https://attacker.test')
    await expect(
      test.invoke(actions.markFeedbackReviewed, { ...scope, feedbackId: 'feedback' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    expect(test.sqlite.prepare("SELECT status FROM feedback WHERE id='feedback'").get()?.status).toBe('new')
    expect(test.invalidated).toHaveBeenCalledOnce()
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('rejects empty/oversized selections and origins using actual schemas', async () => {
    const test = fixture()
    for (const feedbackIds of [[], Array.from({ length: 501 }, (_value, index) => String(index))]) {
      await expect(test.invoke(actions.markSelectedFeedbackReviewed, { ...scope, feedbackIds })).rejects.toMatchObject({
        _tag: 'SchemaError',
      })
    }
    await expect(
      test.invoke(
        actions.createFeedbackSource,
        null,
        formData({ ...scope, name: 'Source', description: '', origins: 'x'.repeat(2001) }),
      ),
    ).rejects.toMatchObject({ _tag: 'SchemaError' })
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('updates, rotates and revokes a real scoped feedback source', async () => {
    const test = fixture()
    const reference = { ...scope, sourceId: 'source' }
    await expect(test.invoke(actions.setFeedbackSourceActive, { ...reference, active: false })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare("SELECT is_active FROM feedback_sources WHERE id='source'").get()?.is_active).toBe(0)
    await expect(test.invoke(actions.rotateFeedbackSourceToken, reference)).resolves.toMatchObject({
      ok: true,
      value: { token: expect.stringMatching(/^fbk_/u) },
    })
    expect(test.sqlite.prepare("SELECT token_hash FROM feedback_sources WHERE id='source'").get()?.token_hash).not.toBe(
      'initial-hash',
    )
    await expect(test.invoke(actions.revokeFeedbackSource, reference)).resolves.toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare("SELECT revoked_at FROM feedback_sources WHERE id='source'").get()?.revoked_at).toEqual(
      expect.any(Number),
    )
    await expect(test.invoke(actions.rotateFeedbackSourceToken, reference)).resolves.toMatchObject({
      ok: false,
      status: 409,
    })
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('marks individual and selected feedback reviewed with concrete result counts', async () => {
    const test = fixture()
    await expect(test.invoke(actions.markFeedbackReviewed, { ...scope, feedbackId: 'feedback' })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.sqlite.prepare("SELECT status FROM feedback WHERE id='feedback'").get()?.status).toBe('reviewed')
    await expect(
      test.invoke(actions.markSelectedFeedbackReviewed, { ...scope, feedbackIds: ['feedback2'] }),
    ).resolves.toEqual({
      ok: true,
      value: { updated: 1 },
    })
    expect(test.sqlite.prepare("SELECT status FROM feedback WHERE id='feedback2'").get()?.status).toBe('reviewed')
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('converts feedback to a real issue and rejects duplicate conversion', async () => {
    const test = fixture()
    const reference = { ...scope, feedbackId: 'feedback' }
    const result = await test.invoke(actions.convertFeedbackToIssue, reference)
    expect(result).toMatchObject({ ok: true, value: { id: expect.any(String), number: expect.any(Number) } })
    const feedback = test.sqlite.prepare("SELECT status,linked_issue_id FROM feedback WHERE id='feedback'").get()
    expect(feedback).toMatchObject({ linked_issue_id: expect.any(String), status: 'actioned' })
    if (!Predicate.isString(feedback?.linked_issue_id)) {
      throw new Error('Expected linked issue ID.')
    }
    expect(test.sqlite.prepare('SELECT title FROM issues WHERE id=?').get(feedback.linked_issue_id)?.title).toBe(
      'Please improve search',
    )
    await expect(test.invoke(actions.convertFeedbackToIssue, reference)).resolves.toMatchObject({
      ok: false,
      status: 409,
    })
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('bulk converts selected feedback into one issue with linked count', async () => {
    const test = fixture()
    await expect(
      test.invoke(actions.convertSelectedFeedbackToIssue, { ...scope, feedbackIds: ['feedback', 'feedback2'] }),
    ).resolves.toMatchObject({
      ok: true,
      value: { convertedCount: 2, id: expect.any(String), number: expect.any(Number) },
    })
    expect(
      test.sqlite.prepare("SELECT count(DISTINCT linked_issue_id) AS count FROM feedback WHERE status='actioned'").get()
        ?.count,
    ).toBe(1)
    expect(test.sqlite.prepare('SELECT title FROM issues WHERE project_id=?').get(scope.projectId)?.title).toBe(
      '2 feedback items',
    )
    expect(test.transport).not.toHaveBeenCalled()
  })

  test('preserves source-admin and feedback project-write authority from shared commands', async () => {
    const test = fixture()
    test.sqlite.exec(
      `UPDATE workspace_members SET role='member' WHERE user_id='u1'; INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('g1','w1','Team',1); INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('g1','u1','u1',1); INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('g1','${scope.projectId}','viewer');`,
    )
    await expect(
      test.invoke(actions.setFeedbackSourceActive, { ...scope, sourceId: 'source', active: false }),
    ).resolves.toMatchObject({ ok: false, status: 403 })
    await expect(
      test.invoke(actions.markFeedbackReviewed, { ...scope, feedbackId: 'feedback' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
    })
    test.sqlite.exec("UPDATE group_project_grants SET role='member' WHERE group_id='g1'")
    await expect(test.invoke(actions.markFeedbackReviewed, { ...scope, feedbackId: 'feedback' })).resolves.toEqual({
      ok: true,
      value: { ok: true },
    })
    expect(test.transport).not.toHaveBeenCalled()
  })
})
