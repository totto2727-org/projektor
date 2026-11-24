import { String, Predicate } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  authHeaders,
  seedComment,
  seedFixture,
  seedIssue,
  seedIssueFixture,
  seedProject,
  seedProjectFixture,
} from './helpers.ts'
import { fetchNativeApi, requestOptionsWithBody } from './native-fetch.ts'

/*
 * PROJ-439: conditional GETs. The ETag is a hash of the response body, so a mutation
 * that changes the body changes the tag by construction — there is no invalidation list
 * to keep in step. What these tests protect is the part that isn't structural: that a
 * 304 can only ever replace a 200 the same caller was already entitled to.
 */

const get = async function get(
  path: string,
  token: string,
  slug: string,
  ifNoneMatch?: string | null,
): Promise<Response> {
  return fetchNativeApi(`http://localhost${path}`, {
    headers: {
      ...authHeaders(token, slug),
      ...(Predicate.isNotNullish(ifNoneMatch) && String.isNonEmpty(ifNoneMatch)
        ? { 'If-None-Match': ifNoneMatch }
        : {}),
    },
  })
}

describe('covers PROJ-439 — ETag / conditional GET', () => {
  test('tags a 200 and answers a matching If-None-Match with an empty 304', async () => {
    const testFixture = await seedIssueFixture({ role: 'owner' })

    const first = await get(`/api/issues/${testFixture.issueId}`, testFixture.token, testFixture.slug)
    expect(first.status).toBe(200)
    const etag = first.headers.get('ETag')
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/u)
    expect(first.headers.get('Cache-Control')).toBe('private, no-cache')

    const second = await get(`/api/issues/${testFixture.issueId}`, testFixture.token, testFixture.slug, etag)
    expect(second.status).toBe(304)
    await expect(second.text()).resolves.toBe('')
    expect(second.headers.get('ETag')).toBe(etag)
    /*
     * Retained on the 304 so the browser keeps revalidating rather than falling back
     * to a heuristic freshness lifetime for the entry it just refreshed.
     */
    expect(second.headers.get('Cache-Control')).toBe('private, no-cache')
  })

  test('accepts a weak validator and a comma-separated If-None-Match list', async () => {
    const testFixture = await seedIssueFixture({ role: 'owner' })
    const etag = (await get(`/api/issues/${testFixture.issueId}`, testFixture.token, testFixture.slug)).headers.get(
      'ETag',
    )

    const weak = await get(`/api/issues/${testFixture.issueId}`, testFixture.token, testFixture.slug, `W/${etag}`)
    expect(weak.status).toBe(304)

    const list = await get(
      `/api/issues/${testFixture.issueId}`,
      testFixture.token,
      testFixture.slug,
      `"other", ${etag}`,
    )
    expect(list.status).toBe(304)
  })

  test('does not 304 a stale validator', async () => {
    const testFixture = await seedIssueFixture({ role: 'owner' })
    const res = await get(`/api/issues/${testFixture.issueId}`, testFixture.token, testFixture.slug, '"deadbeef"')
    expect(res.status).toBe(200)
  })

  // ---- a mutation must never leave a stale 304 behind ----

  test('handles PATCH to an issue makes the next conditional GET a 200 with the new content', async () => {
    const testFixture = await seedIssueFixture({ issueTitle: 'Before', role: 'owner' })
    const etag = (await get(`/api/issues/${testFixture.issueId}`, testFixture.token, testFixture.slug)).headers.get(
      'ETag',
    )

    const patch = await fetchNativeApi(
      `http://localhost/api/issues/${testFixture.issueId}`,
      requestOptionsWithBody(
        'PATCH',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ title: 'After' }),
      ),
    )
    expect(patch.status).toBe(200)

    const after = await get(`/api/issues/${testFixture.issueId}`, testFixture.token, testFixture.slug, etag)
    expect(after.status).toBe(200)
    const body = await after.json<{ title: string }>()
    expect(body.title).toBe('After')
    expect(after.headers.get('ETag')).not.toBe(etag)
  })

  test('a new comment makes the next conditional GET of the comment list a 200', async () => {
    const testFixture = await seedIssueFixture({ role: 'owner' })
    const path = `/api/issues/${testFixture.issueId}/comments`
    const etag = (await get(path, testFixture.token, testFixture.slug)).headers.get('ETag')

    const post = await fetchNativeApi(
      `http://localhost${path}`,
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ body: 'new comment' }),
      ),
    )
    expect(post.status).toBe(201)

    const after = await get(path, testFixture.token, testFixture.slug, etag)
    expect(after.status).toBe(200)
    await expect(after.json<unknown[]>()).resolves.toHaveLength(1)
  })

  test('creating a task status makes the next conditional GET of the list a 200', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const etag = (await get('/api/task-statuses', testFixture.token, testFixture.slug)).headers.get('ETag')

    const post = await fetchNativeApi(
      'http://localhost/api/task-statuses',
      requestOptionsWithBody(
        'POST',
        authHeaders(testFixture.token, testFixture.slug),
        JSON.stringify({ key: 'triage', name: 'Triage', category: 'todo' }),
      ),
    )
    expect(post.status).toBe(201)

    const after = await get('/api/task-statuses', testFixture.token, testFixture.slug, etag)
    expect(after.status).toBe(200)
  })

  /*
   * ---- a 304 must never stand in for a 403 or a 404 ----
   *
   * Each of these replays a validator obtained by someone who *was* entitled to the
   * resource. That's the case that matters: an unauthorised caller who guesses or is
   * handed a valid ETag must still be refused, not handed an empty 304 that tells them
   * their copy is current.
   */

  test('a non-member replaying a valid ETag gets 403, not 304', async () => {
    const owner = await seedIssueFixture({ role: 'owner' })
    const etag = (await get(`/api/issues/${owner.issueId}`, owner.token, owner.slug)).headers.get('ETag')

    // A user with a token of their own, but no membership of the owner's workspace.
    const outsider = await seedFixture({ role: 'owner' })

    const res = await get(`/api/issues/${owner.issueId}`, outsider.token, owner.slug, etag)
    expect(res.status).toBe(403)
    expect(res.headers.get('ETag')).toBeNull()
  })

  test('a cross-workspace token replaying a valid ETag gets 403, not 304', async () => {
    const owner = await seedIssueFixture({ role: 'owner' })
    const etag = (await get(`/api/issues/${owner.issueId}`, owner.token, owner.slug)).headers.get('ETag')

    /*
     * API tokens are workspace-scoped (PROJ-16). Pointing one at another workspace's
     * slug is refused by the confinement check, which runs ahead of the membership
     * check — so this 403 is the token scope, distinct from the non-member case above.
     */
    const other = await seedFixture({ role: 'owner' })

    const res = await get(`/api/issues/${owner.issueId}`, other.token, owner.slug, etag)
    expect(res.status).toBe(403)
  })

  test('a member with no project grant replaying a valid ETag gets 404, not 304', async () => {
    /*
     * PROJ-311 access is default-deny per project, so this is the in-workspace
     * equivalent of the two cases above.
     */
    const testFixture = await seedProjectFixture({ role: 'member' })
    const ungranted = await seedProject(testFixture.workspaceId, 'NOGRANT')
    const issue = await seedIssue(testFixture.workspaceId, ungranted.id, testFixture.userId, { title: 'Invisible' })
    await seedComment(issue.id, testFixture.userId, 'secret')

    const denied = await get(`/api/issues/${issue.id}/comments`, testFixture.token, testFixture.slug, '"anything"')
    expect(denied.status).toBe(404)
    expect(denied.headers.get('ETag')).toBeNull()
  })

  test('does not tag a non-200, so an error body can never become a 304', async () => {
    const testFixture = await seedProjectFixture({ role: 'owner' })
    const missing = await get(`/api/issues/${crypto.randomUUID()}`, testFixture.token, testFixture.slug)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('ETag')).toBeNull()
    expect(missing.headers.get('Cache-Control')).toBeNull()
  })
})
