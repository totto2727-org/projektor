// oxlint-disable-next-line rules/no-node-imports -- Playwright's multipart upload fixture requires a Node Buffer.
import { Buffer } from 'node:buffer'

import { expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { HTTP_CREATED, HTTP_NOT_FOUND, HTTP_NO_CONTENT, HTTP_OK } from '#contracts/http-status.ts'
import { SECONDS_PER_WEEK, currentEpochSeconds } from '#contracts/time.ts'
import { runInOrder } from '#tests/run-effect.ts'

import { readAcceptanceJson } from './response-json.ts'

const FIXTURE_SUFFIX_START = 0
const FIXTURE_SUFFIX_LENGTH = 6
const ATTACHMENT_FIXTURE_BYTES = 65_536

type ReaderFixtures = Readonly<{
  epic: Readonly<{ title: string }>
  feedbackBody: string
  group: Readonly<{ name: string }>
  issue: Readonly<{ id: string; number: number; title: string }>
  project: Readonly<{ id: string; key: string; name: string; slug: string }>
  shareToken: string
  sourceId: string
  sourceName: string
  sprints: Readonly<{ status: string; name: string }[]>
  user: Readonly<{ email: string }>
  wiki: Readonly<{ slug: string; title?: string }>
}>

/**
 * Read-only page fixtures use the actual local API. They do not replace native create tests.
 *
 * @param {APIRequestContext} request The request context for the local acceptance API.
 * @returns {Promise<ReaderFixtures>} The records read by the route and dataset scenarios.
 */
export const createReaderFixtures = async function createReaderFixtures(
  request: APIRequestContext,
): Promise<ReaderFixtures> {
  const suffix = globalThis.crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(FIXTURE_SUFFIX_START, FIXTURE_SUFFIX_LENGTH)
    .toLowerCase()
  const headers = { 'X-Workspace-Slug': 'projektor' }
  const sessionResponse = await request.get('http://127.0.0.1:4392/auth/me')
  expect(sessionResponse.status()).toBe(HTTP_OK)
  const { user } = await readAcceptanceJson(sessionResponse, 'session')
  const createdProject = await request.post('http://127.0.0.1:4392/api/projects', {
    headers,
    data: { name: `Reader project ${suffix}`, key: `R${suffix.toUpperCase()}` },
  })
  expect(createdProject.status(), await createdProject.text()).toBe(HTTP_CREATED)
  const project = await readAcceptanceJson(createdProject, 'project')
  const createdIssue = await request.post('http://127.0.0.1:4392/api/issues', {
    headers,
    data: {
      projectId: project.id,
      title: `Reader issue ${suffix}`,
      body: 'Persisted reader body.',
      assigneeId: user.id,
    },
  })
  expect(createdIssue.status(), await createdIssue.text()).toBe(HTTP_CREATED)
  const issue = { ...(await readAcceptanceJson(createdIssue, 'issue')), title: `Reader issue ${suffix}` }
  // Reciprocal file parity: both real adapters delegate to private Core.
  // This fixture does not replace the separate browser-native upload/delete flow.
  const fileBytes = Buffer.alloc(ATTACHMENT_FIXTURE_BYTES, `api-web-file-${suffix}\n`)
  const uploadedFile = await request.post('http://127.0.0.1:4392/api/files', {
    headers,
    multipart: {
      file: { name: `api-file-${suffix}.txt`, mimeType: 'text/plain', buffer: fileBytes },
      entityType: 'issue',
      entityId: issue.id,
    },
  })
  expect(uploadedFile.status(), await uploadedFile.text()).toBe(HTTP_CREATED)
  const uploaded = await readAcceptanceJson(uploadedFile, 'attachment')
  expect(uploaded).toMatchObject({
    contentType: 'text/plain',
    filename: `api-file-${suffix}.txt`,
    size: ATTACHMENT_FIXTURE_BYTES,
  })
  const nativeFileUrl = `http://127.0.0.1:4393/api/files/${uploaded.id}?workspace=projektor`
  const nativeFile = await request.get(nativeFileUrl)
  expect(nativeFile.status()).toBe(HTTP_OK)
  expect(await nativeFile.body()).toEqual(fileBytes)
  expect(nativeFile.headers()['content-type']).toBe('application/octet-stream')
  expect(nativeFile.headers()['cache-control']).toBe('private, no-store')
  const deletedFile = await request.delete(`http://127.0.0.1:4392/api/files/${uploaded.id}`, { headers })
  expect(deletedFile.status()).toBe(HTTP_NO_CONTENT)
  const fileResponse = await request.get(nativeFileUrl)
  expect(fileResponse.status()).toBe(HTTP_NOT_FOUND)
  const createdWiki = await request.post('http://127.0.0.1:4392/api/wiki', {
    headers,
    data: {
      projectId: project.id,
      title: `Reader wiki ${suffix}`,
      slug: `reader-${suffix}`,
      content: 'Persisted Wiki reader body.',
    },
  })
  expect(createdWiki.status(), await createdWiki.text()).toBe(HTTP_CREATED)
  const wiki = await readAcceptanceJson(createdWiki, 'wiki')
  const sourceName = `Reader source ${suffix}`
  const createdSource = await request.post(`http://127.0.0.1:4392/api/projects/${project.id}/feedback-sources`, {
    headers,
    data: { name: sourceName },
  })
  expect(createdSource.status()).toBe(HTTP_CREATED)
  const { id: sourceId, token: sourceToken } = await readAcceptanceJson(createdSource, 'feedbackSource')
  const feedbackBody = `Persisted feedback ${suffix}`
  // This API is the real external-submission interface, not a browser mutation substitute.
  const submittedFeedback = await request.post('http://127.0.0.1:4392/api/feedback/submit', {
    headers: { Authorization: `Bearer ${sourceToken}` },
    data: { body: feedbackBody, rating: 5, ratingScale: 'five_star', appVersion: 'acceptance-v1' },
  })
  expect(submittedFeedback.status()).toBe(HTTP_CREATED)
  // The new local-only feedback credential is never returned, logged or stored.
  const typesResponse = await request.get('http://127.0.0.1:4392/api/task-types', { headers })
  expect(typesResponse.status()).toBe(HTTP_OK)
  const types = await readAcceptanceJson(typesResponse, 'taskTypes')
  const epicType = types.find((type) => type.name === 'Epic')
  expect(epicType).toBeDefined()
  const createdEpic = await request.post('http://127.0.0.1:4392/api/issues', {
    headers,
    data: { projectId: project.id, title: `Reader epic ${suffix}`, typeId: epicType?.id },
  })
  expect(createdEpic.status()).toBe(HTTP_CREATED)
  const epic = { ...(await readAcceptanceJson(createdEpic, 'issue')), title: `Reader epic ${suffix}` }
  const createdGroup = await request.post('http://127.0.0.1:4392/api/workspaces/projektor/groups', {
    headers,
    data: { name: `Reader group ${suffix}` },
  })
  expect(createdGroup.status(), await createdGroup.text()).toBe(HTTP_CREATED)
  const group = await readAcceptanceJson(createdGroup, 'group')
  const now = currentEpochSeconds()
  const sprints: { status: string; name: string }[] = []
  await runInOrder(['planned', 'completed', 'active'], async (status): Promise<void> => {
    const name = `Reader ${status} sprint ${suffix}`
    const created = await request.post('http://127.0.0.1:4392/api/sprints', {
      headers,
      data: { projectId: project.id, name, startDate: now, endDate: now + SECONDS_PER_WEEK },
    })
    expect(created.status()).toBe(HTTP_CREATED)
    const sprint = await readAcceptanceJson(created, 'sprint')
    if (status !== 'planned') {
      const started = await request.patch(`http://127.0.0.1:4392/api/sprints/${sprint.id}`, {
        headers,
        data: { status: 'active' },
      })
      expect(started.status()).toBe(HTTP_OK)
    }
    if (status === 'completed') {
      const completed = await request.post(`http://127.0.0.1:4392/api/sprints/${sprint.id}/complete`, {
        headers,
        data: {},
      })
      expect(completed.status()).toBe(HTTP_OK)
    }
    sprints.push({ status, name })
  })
  const createdShare = await request.post(`http://127.0.0.1:4392/api/issues/${issue.id}/share`, {
    headers,
    data: {},
  })
  expect(createdShare.status()).toBe(HTTP_CREATED)
  const { token: shareToken } = await readAcceptanceJson(createdShare, 'share')
  return {
    project,
    issue,
    wiki,
    sourceId,
    sourceName,
    shareToken,
    epic,
    group,
    user,
    sprints,
    feedbackBody,
  }
}
