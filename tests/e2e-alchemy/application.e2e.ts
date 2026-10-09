import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

type BrowserAudit = {
  pageErrors: string[]
  consoleErrors: string[]
  directApiRequests: { url: string; method: string; resourceType: string }[]
  checkpoints: {
    name: string
    url: string
    innerWidth: number
    documentWidth: number
    viewportWidth: number
  }[]
}
const pageAudits = new WeakMap<Page, BrowserAudit>()
const testAudits = new Map<string, BrowserAudit[]>()

function observeBrowser(page: Page, testInfo: TestInfo) {
  const existing = pageAudits.get(page)
  if (existing) return existing
  const audit: BrowserAudit = {
    pageErrors: [],
    consoleErrors: [],
    directApiRequests: [],
    checkpoints: [],
  }
  pageAudits.set(page, audit)
  const audits = testAudits.get(testInfo.testId) ?? []
  audits.push(audit)
  testAudits.set(testInfo.testId, audits)
  page.on('pageerror', (error) => audit.pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') audit.consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType()) && new URL(request.url()).pathname.startsWith('/api/')) {
      audit.directApiRequests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
      })
    }
  })
  return audit
}

test.beforeEach(async ({ page }, testInfo) => {
  observeBrowser(page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  observeBrowser(page, testInfo)
  const audits = testAudits.get(testInfo.testId) ?? []
  const path = testInfo.outputPath('browser-audit.json')
  await writeFile(path, JSON.stringify({ project: testInfo.project.name, audits }, null, 2))
  await testInfo.attach('browser-audit', { path, contentType: 'application/json' })
  testAudits.delete(testInfo.testId)
  for (const audit of audits) {
    expect(audit.pageErrors, 'Browser pageerror including hydration').toEqual([])
    expect(audit.consoleErrors, 'Browser console.error including hydration').toEqual([])
    expect(audit.directApiRequests, 'Browser must not use direct /api fetch or XHR').toEqual([])
  }
})

async function checkpoint(page: Page, testInfo: TestInfo, name: string) {
  const dimensions = await page.evaluate(() => ({
    innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  const viewportWidth = page.viewportSize()?.width
  expect(viewportWidth, 'Acceptance viewport must be explicit').toBeDefined()
  if (viewportWidth === undefined) throw new Error('Acceptance viewport must be explicit.')
  observeBrowser(page, testInfo).checkpoints.push({
    name,
    url: page.url(),
    ...dimensions,
    viewportWidth,
  })
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true })
  expect(dimensions.documentWidth, `${name}: document must fit viewport`).toBeLessThanOrEqual(dimensions.innerWidth)
  expect(dimensions.innerWidth, `${name}: layout viewport must not expand`).toBeLessThanOrEqual(viewportWidth)
  expect(dimensions.documentWidth, `${name}: document must fit configured viewport`).toBeLessThanOrEqual(viewportWidth)
}

test('real API write is visible in frontend direct shared D1 read', async ({ request, page }, testInfo) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const name = `Shared D1 ${suffix}`
  const write = await request.post('http://127.0.0.1:4392/api/projects', {
    headers: { 'X-Workspace-Slug': 'projektor' },
    data: { name, key: `D${suffix}` },
  })
  expect(write.status(), await write.text()).toBe(201)
  const project = await write.json()
  expect(project.id).toBeTruthy()
  const response = await page.goto('/?workspace=projektor')
  expect(response?.status()).toBe(200)
  // The application catalog loader reads the frontend DB binding directly.
  // This server-side fixture write reached the separate actual API Worker
  // service through its loopback socket, not hydrated component state. It is
  // not claimed as a native browser mutation.
  const link = page.getByRole('link').filter({ has: page.getByText(name, { exact: true }) })
  await expect(link).toHaveCount(1)
  expect(new URL((await link.getAttribute('href')) ?? '', page.url()).searchParams.get('projectId')).toBe(project.id)
  await checkpoint(page, testInfo, 'api-write-frontend-shared-db-read')
  await link.click()
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
  await checkpoint(page, testInfo, 'shared-db-project-reload')
})

async function assertShell(page: Page) {
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('link', { name: /skip to (main )?content/i })).toBeAttached()
  await expect(page.getByRole('button', { name: /^Account(?::|$)/ })).toBeVisible()
  const menu = page.locator('header.projektor-topbar').getByRole('button', { name: 'Toggle Sidebar', exact: true })
  if (await menu.isVisible()) {
    await menu.click()
    await expect(page.getByRole('list', { name: 'Primary navigation', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
  } else {
    await expect(page.getByRole('list', { name: 'Primary navigation', exact: true })).toBeVisible()
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('cold protected initial HTML is usable without JavaScript', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: testInfo.project.name === 'mobile' ? { width: 393, height: 851 } : { width: 1440, height: 1000 },
  })
  try {
    const page = await context.newPage()
    observeBrowser(page, testInfo)
    const response = await page.goto('/?workspace=projektor')
    expect(response?.status()).toBe(200)
    expect(response?.headers()['cache-control']).toMatch(/private/)
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Account(?::|$)/ })).toBeVisible()
    await expect(page.getByText(/temporarily unavailable|session has expired/i)).toHaveCount(0)
    await checkpoint(page, testInfo, 'initial-no-js')
  } finally {
    await context.close()
  }
})

test('native create project and issue refresh canonical reads and navigation', async ({
  page,
  browser,
  baseURL,
  request,
}, testInfo) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const projectName = `Alchemy acceptance ${suffix}`
  const projectKey = `E${suffix}`
  const issueTitle = `Native issue ${suffix}`
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?workspace=projektor')
  await assertShell(page)
  await checkpoint(page, testInfo, 'initial-shell')
  // Native <details> remains operable without depending on CSS/component internals.
  await page.getByText('+ New project', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(projectName)
  await page.getByRole('textbox', { name: 'Key', exact: true }).fill(projectKey)
  await checkpoint(page, testInfo, 'native-project-form')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const projectLink = page.getByRole('link').filter({ hasText: projectName })
  await expect(projectLink).toHaveCount(1)
  await checkpoint(page, testInfo, 'project-created-canonical-list')
  await projectLink.click()
  await expect(page.getByRole('heading', { name: projectName, exact: true, level: 1 })).toBeVisible()
  await checkpoint(page, testInfo, 'project-created-detail')
  await expect(page).toHaveURL((url) => url.pathname.startsWith('/projects/view/'))
  const projectUrl = page.url()
  const sections = page.getByRole('navigation', { name: 'Project sections' })
  await sections.getByRole('link', { name: 'Issues', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/issues')
  const issuesUrl = page.url()
  expect(new URL(issuesUrl).searchParams.get('workspace')).toBe('projektor')
  expect(new URL(issuesUrl).searchParams.get('projectId')).toBeTruthy()
  await checkpoint(page, testInfo, 'project-scoped-issues')
  await page.getByRole('button', { name: /New issue/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Create new issue' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('Issue title').fill(issueTitle)
  await checkpoint(page, testInfo, 'native-issue-form')
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const issueLink = page.getByRole('link', { name: issueTitle, exact: true })
  await expect(issueLink).toBeVisible()
  await checkpoint(page, testInfo, 'issue-created-canonical-list')
  const canonicalIssueUrl = new URL((await issueLink.getAttribute('href')) ?? '', page.url()).href
  await issueLink.click()
  await expect(page.getByRole('heading', { name: issueTitle, exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-created-detail')
  await expect(page).toHaveURL(canonicalIssueUrl)
  const issueUrl = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { name: issueTitle, exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue')
  const issueBody = `Native direct-read update ${suffix}`
  await page.getByTitle('Edit description', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown editor', exact: true }).fill(issueBody)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(issueBody, { exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-updated-canonical-body')
  await page.reload()
  await expect(page.getByText(issueBody, { exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-updated-body-reload')
  const filename = `native-attachment-${suffix}.txt`
  const bytes = Buffer.alloc(65_536, 'native-effront-attachment\n')
  await page.getByRole('button', { name: /Attach file/ }).click()
  await page.getByLabel('Choose file', { exact: true }).setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: bytes,
  })
  await checkpoint(page, testInfo, 'native-attachment-form')
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const attachment = page.locator('a[href^="/api/files/"]').filter({ hasText: filename })
  await expect(attachment).toBeVisible()
  const filePath = new URL((await attachment.getAttribute('href')) ?? '', page.url()).pathname
  const apiFile = await request.get(`http://127.0.0.1:4392${filePath}`, {
    headers: { 'X-Workspace-Slug': 'projektor' },
  })
  expect(apiFile.status()).toBe(200)
  expect(await apiFile.body()).toEqual(bytes)
  expect(apiFile.headers()['content-type']).toBe('application/octet-stream')
  expect(apiFile.headers()['x-content-type-options']).toBe('nosniff')
  await page.reload()
  await expect(attachment).toBeVisible()
  await checkpoint(page, testInfo, 'native-attachment-reload')
  const downloadPromise = page.waitForEvent('download')
  await attachment.click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  if (!stream) throw new Error('The native attachment download returned no stream.')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(bytes)
  await checkpoint(page, testInfo, 'native-attachment-download')
  await page.getByRole('button', { name: `Remove ${filename}`, exact: true }).click()
  await expect(attachment).toHaveCount(0)
  await page.reload()
  await expect(attachment).toHaveCount(0)
  const removedFile = await request.get(`http://127.0.0.1:4392${filePath}`, {
    headers: { 'X-Workspace-Slug': 'projektor' },
  })
  expect(removedFile.status()).toBe(404)
  await checkpoint(page, testInfo, 'native-attachment-deleted-reload')
  await page.goBack()
  await expect(page).toHaveURL(issuesUrl)
  await expect(page.getByRole('link', { name: issueTitle, exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-back-scoped-list')
  await page.goForward()
  await expect(page).toHaveURL(issueUrl)
  await expect(page.getByRole('heading', { name: issueTitle, exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-forward-detail')
  await assertShell(page)
  await page.goto(projectUrl)
  await checkpoint(page, testInfo, 'project')
  await page
    .getByRole('navigation', { name: 'Project sections' })
    .getByRole('link', { name: 'Wiki', exact: true })
    .click()
  await expect(page).toHaveURL((url) => url.pathname === '/wiki')
  const wikiScope = new URL(page.url())
  expect(wikiScope.searchParams.get('workspace')).toBe('projektor')
  expect(wikiScope.searchParams.get('projectId')).toBe(new URL(projectUrl).searchParams.get('projectId'))
  await checkpoint(page, testInfo, 'project-scoped-wiki')
  const pages = page.getByRole('button', { name: 'Pages', exact: true })
  if (await pages.isVisible()) await pages.click()
  await page.getByRole('button', { name: '+ New page', exact: true }).click()
  const wikiTitle = `Native wiki ${suffix}`
  await page.getByPlaceholder('Page title', { exact: true }).fill(wikiTitle)
  const editor = page.getByRole('textbox', { name: 'Markdown editor', exact: true })
  await expect(editor).toBeVisible()
  await editor.fill(
    `## Comark acceptance ${suffix}\n\nA **strong** native paragraph.\n\n- One\n- Two\n\n[Scoped project](${projectUrl})\n\n<script>window.__acceptanceInjected = true</script>`,
  )
  await checkpoint(page, testInfo, 'native-wiki-form')
  await page.getByRole('button', { name: 'Create page', exact: true }).click()
  await expect(page.getByRole('heading', { name: wikiTitle, exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: `Comark acceptance ${suffix}`, exact: true, level: 2 })).toBeVisible()
  await expect(page.locator('strong').filter({ hasText: /^strong$/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Scoped project', exact: true })).toHaveAttribute('href', projectUrl)
  expect(await page.evaluate(() => '__acceptanceInjected' in window)).toBe(false)
  await checkpoint(page, testInfo, 'wiki-created-comark-render')
  await expect(page).toHaveURL((url) => url.pathname.startsWith('/wiki/'))
  const wikiUrl = page.url()
  expect(new URL(wikiUrl).searchParams.get('workspace')).toBe('projektor')
  expect(new URL(wikiUrl).searchParams.get('projectId')).toBe(new URL(projectUrl).searchParams.get('projectId'))
  await page.reload()
  await expect(page.getByRole('heading', { name: wikiTitle, exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: `Comark acceptance ${suffix}`, exact: true, level: 2 })).toBeVisible()
  expect(await page.evaluate(() => '__acceptanceInjected' in window)).toBe(false)
  await checkpoint(page, testInfo, 'wiki-reload-comark-render')
  const timeOrigin = await page.evaluate(() => performance.timeOrigin)
  const refreshPost = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/auth/session' && response.request().method() === 'POST',
  )
  const refreshedDocument = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  })
  await page.getByRole('button', { name: /^Account(?::|$)/ }).click()
  await page.getByRole('menuitem', { name: 'Refresh session', exact: true }).click()
  expect((await refreshPost).status()).toBe(303)
  await refreshedDocument
  await expect(page).toHaveURL(wikiUrl)
  await expect(page.getByRole('heading', { name: wikiTitle, exact: true, level: 1 })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(timeOrigin)
  await checkpoint(page, testInfo, 'native-session-document-refresh')
  // A fresh document with JS disabled proves the mutation reached real D1,
  // rather than being held in hydrated component state.
  const noJs = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: page.viewportSize(),
  })
  try {
    const cold = await noJs.newPage()
    observeBrowser(cold, testInfo)
    expect((await cold.goto(issueUrl))?.status()).toBe(200)
    await expect(cold.getByRole('heading', { name: issueTitle, exact: true })).toBeVisible()
    await checkpoint(cold, testInfo, 'cold-persisted-issue-no-js')
  } finally {
    await noJs.close()
  }
  expect(errors).toEqual([])
})

/** Read-only page fixtures use the actual local API. They do not replace native create tests. */
async function createReaderFixtures(request: APIRequestContext) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toLowerCase()
  const headers = { 'X-Workspace-Slug': 'projektor' }
  const sessionResponse = await request.get('http://127.0.0.1:4392/auth/me')
  expect(sessionResponse.status()).toBe(200)
  const { user } = await sessionResponse.json()
  const createdProject = await request.post('http://127.0.0.1:4392/api/projects', {
    headers,
    data: { name: `Reader project ${suffix}`, key: `R${suffix.toUpperCase()}` },
  })
  expect(createdProject.status(), await createdProject.text()).toBe(201)
  const project = await createdProject.json()
  const createdIssue = await request.post('http://127.0.0.1:4392/api/issues', {
    headers,
    data: {
      projectId: project.id,
      title: `Reader issue ${suffix}`,
      body: 'Persisted reader body.',
      assigneeId: user.id,
    },
  })
  expect(createdIssue.status(), await createdIssue.text()).toBe(201)
  const issue = { ...(await createdIssue.json()), title: `Reader issue ${suffix}` }
  // Reciprocal file parity: the real API writes/deletes, while Web reads directly.
  // This fixture does not replace the separate browser-native upload/delete flow.
  const fileBytes = Buffer.alloc(65_536, `api-web-file-${suffix}\n`)
  const uploadedFile = await request.post('http://127.0.0.1:4392/api/files', {
    headers,
    multipart: {
      file: { name: `api-file-${suffix}.txt`, mimeType: 'text/plain', buffer: fileBytes },
      entityType: 'issue',
      entityId: issue.id,
    },
  })
  expect(uploadedFile.status(), await uploadedFile.text()).toBe(201)
  const uploaded = await uploadedFile.json()
  expect(uploaded).toMatchObject({ filename: `api-file-${suffix}.txt`, contentType: 'text/plain', size: 65_536 })
  const nativeFileUrl = `http://127.0.0.1:4393/api/files/${uploaded.id}?workspace=projektor`
  const nativeFile = await request.get(nativeFileUrl)
  expect(nativeFile.status()).toBe(200)
  expect(await nativeFile.body()).toEqual(fileBytes)
  expect(nativeFile.headers()['content-type']).toBe('application/octet-stream')
  expect(nativeFile.headers()['cache-control']).toBe('private, no-store')
  const deletedFile = await request.delete(`http://127.0.0.1:4392/api/files/${uploaded.id}`, { headers })
  expect(deletedFile.status()).toBe(204)
  expect((await request.get(nativeFileUrl)).status()).toBe(404)
  const createdWiki = await request.post('http://127.0.0.1:4392/api/wiki', {
    headers,
    data: {
      projectId: project.id,
      title: `Reader wiki ${suffix}`,
      slug: `reader-${suffix}`,
      content: 'Persisted Wiki reader body.',
    },
  })
  expect(createdWiki.status(), await createdWiki.text()).toBe(201)
  const wiki = await createdWiki.json()
  const sourceName = `Reader source ${suffix}`
  const createdSource = await request.post(`http://127.0.0.1:4392/api/projects/${project.id}/feedback-sources`, {
    headers,
    data: { name: sourceName },
  })
  expect(createdSource.status()).toBe(201)
  const { id: sourceId, token: sourceToken } = await createdSource.json()
  const feedbackBody = `Persisted feedback ${suffix}`
  // This API is the real external-submission interface, not a browser mutation substitute.
  const submittedFeedback = await request.post('http://127.0.0.1:4392/api/feedback/submit', {
    headers: { Authorization: `Bearer ${sourceToken}` },
    data: { body: feedbackBody, rating: 5, ratingScale: 'five_star', appVersion: 'acceptance-v1' },
  })
  expect(submittedFeedback.status()).toBe(201)
  // The new local-only feedback credential is never returned, logged or stored.
  const typesResponse = await request.get('http://127.0.0.1:4392/api/task-types', { headers })
  expect(typesResponse.status()).toBe(200)
  const types = await typesResponse.json()
  const epicType = types.find((type: { name: string }) => type.name === 'Epic')
  expect(epicType).toBeDefined()
  const createdEpic = await request.post('http://127.0.0.1:4392/api/issues', {
    headers,
    data: { projectId: project.id, title: `Reader epic ${suffix}`, typeId: epicType.id },
  })
  expect(createdEpic.status()).toBe(201)
  const epic = { ...(await createdEpic.json()), title: `Reader epic ${suffix}` }
  const createdGroup = await request.post('http://127.0.0.1:4392/api/workspaces/projektor/groups', {
    headers,
    data: { name: `Reader group ${suffix}` },
  })
  expect(createdGroup.status(), await createdGroup.text()).toBe(201)
  const group = await createdGroup.json()
  const now = Math.floor(Date.now() / 1000)
  const sprints: { status: string; name: string }[] = []
  for (const status of ['planned', 'completed', 'active']) {
    const name = `Reader ${status} sprint ${suffix}`
    const created = await request.post('http://127.0.0.1:4392/api/sprints', {
      headers,
      data: { projectId: project.id, name, startDate: now, endDate: now + 604_800 },
    })
    expect(created.status()).toBe(201)
    const sprint = await created.json()
    if (status !== 'planned') {
      const started = await request.patch(`http://127.0.0.1:4392/api/sprints/${sprint.id}`, {
        headers,
        data: { status: 'active' },
      })
      expect(started.status()).toBe(200)
    }
    if (status === 'completed') {
      const completed = await request.post(`http://127.0.0.1:4392/api/sprints/${sprint.id}/complete`, {
        headers,
        data: {},
      })
      expect(completed.status()).toBe(200)
    }
    sprints.push({ status, name })
  }
  const createdShare = await request.post(`http://127.0.0.1:4392/api/issues/${issue.id}/share`, {
    headers,
    data: {},
  })
  expect(createdShare.status()).toBe(201)
  const { token: shareToken } = await createdShare.json()
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

test('all final page routes and aliases render real populated HTML with and without JavaScript', async ({
  request,
  browser,
  baseURL,
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const { project, issue, wiki, sourceId, sourceName, shareToken, epic, group, sprints, feedbackBody } =
    await createReaderFixtures(request)
  const scope = new URLSearchParams({ workspace: 'projektor', projectId: project.id }).toString()
  const cases: { id: string; path: string; heading?: string; text?: string; body?: string }[] = [
    { id: 'projects', path: '/?workspace=projektor', heading: 'Projects', body: project.name },
    {
      id: 'overview-query',
      path: `/projects/view?${scope}`,
      heading: project.name,
      body: issue.title,
    },
    {
      id: 'overview-path',
      path: `/projects/view/${project.slug}?workspace=projektor`,
      heading: project.name,
      body: issue.title,
    },
    { id: 'help', path: '/help', heading: 'Getting started' },
    { id: 'issues', path: `/issues?${scope}`, heading: 'Issues', body: issue.title },
    {
      id: 'issue-query',
      path: `/issues/view?id=${issue.id}&${scope}`,
      heading: issue.title,
      body: 'Persisted reader body.',
    },
    {
      id: 'issue-path',
      path: `/projects/${project.key}/issues/${issue.number}/reader-issue?workspace=projektor`,
      heading: issue.title,
      body: 'Persisted reader body.',
    },
    {
      id: 'my-issues',
      path: '/my-issues?workspace=projektor',
      heading: 'My Issues',
      body: issue.title,
    },
    { id: 'epics', path: `/epics?${scope}`, heading: 'Epics', body: epic.title },
    { id: 'sprints', path: `/sprints?${scope}`, heading: 'Sprints', body: sprints[0].name },
    { id: 'metrics', path: `/metrics?${scope}`, heading: 'Metrics' },
    {
      id: 'wiki-index',
      path: `/wiki?${scope}`,
      text: 'Select a page from the sidebar or create a new one.',
    },
    {
      id: 'wiki-query',
      path: `/wiki/view?slug=${wiki.slug}&${scope}`,
      heading: wiki.title,
      body: 'Persisted Wiki reader body.',
    },
    {
      id: 'wiki-path',
      path: `/wiki/${wiki.slug}?${scope}`,
      heading: wiki.title,
      body: 'Persisted Wiki reader body.',
    },
    {
      id: 'feedback-grid',
      path: `/feedback?${scope}`,
      heading: 'Feedback sources',
      body: sourceName,
    },
    {
      id: 'feedback-query',
      path: `/feedback/view?sourceId=${sourceId}&${scope}`,
      heading: sourceName,
      body: feedbackBody,
    },
    {
      id: 'feedback-path',
      path: `/feedback/${sourceId}?${scope}`,
      heading: sourceName,
      body: feedbackBody,
    },
    {
      id: 'groups',
      path: '/settings/groups?workspace=projektor',
      text: 'You manage which groups can access which projects.',
      body: group.name,
    },
    { id: 'tokens', path: '/settings/tokens?workspace=projektor', heading: 'Connect Claude Code' },
    {
      id: 'share-query',
      path: `/share/view?token=${shareToken}`,
      heading: issue.title,
      body: 'Persisted reader body.',
    },
    {
      id: 'share-path',
      path: `/share/${shareToken}`,
      heading: issue.title,
      body: 'Persisted reader body.',
    },
  ]
  expect(cases).toHaveLength(21)
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled,
      viewport: page.viewportSize(),
    })
    try {
      const reader = await context.newPage()
      observeBrowser(reader, testInfo)
      for (const route of cases) {
        const response = await reader.goto(route.path)
        expect(response?.status(), route.id).toBe(200)
        if (route.heading)
          await expect(reader.getByRole('heading', { name: route.heading, exact: true, level: 1 })).toBeVisible()
        if (route.text) await expect(reader.getByText(route.text, { exact: true })).toBeVisible()
        if (route.body) await expect(reader.locator('body')).toContainText(route.body)
        await checkpoint(reader, testInfo, `${javaScriptEnabled ? 'js-on' : 'js-off'}-${route.id}`)
      }
    } finally {
      await context.close()
    }
  }
})

test('large dataset tabs use scoped native URLs and survive reload and history', async ({
  request,
  page,
}, testInfo) => {
  const { project, sourceId, sprints, group, user, feedbackBody } = await createReaderFixtures(request)
  const scope = new URLSearchParams({ workspace: 'projektor', projectId: project.id }).toString()
  await page.goto(`/sprints?${scope}`)
  for (const [name, value] of [
    ['Planned', 'planned'],
    ['Active', 'active'],
    ['History', 'completed'],
    ['All', 'all'],
  ]) {
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('status') === value &&
        url.searchParams.get('projectId') === project.id &&
        url.searchParams.get('workspace') === 'projektor',
    )
    await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    for (const sprint of sprints.filter((sprint) => value === 'all' || sprint.status === value))
      await expect(page.locator('body')).toContainText(sprint.name)
    await checkpoint(page, testInfo, `sprint-tab-${value}`)
  }
  await page.goto('/settings/groups?workspace=projektor')
  await page.getByRole('tab', { name: 'Members', exact: true }).click()
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('view') === 'members' && url.searchParams.get('workspace') === 'projektor',
  )
  await expect(page.getByRole('tab', { name: 'Members', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText(user.email)
  await checkpoint(page, testInfo, 'groups-members-tab')
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Members', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Groups', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'groups')
  await expect(page.getByRole('tabpanel')).toContainText(group.name)
  await checkpoint(page, testInfo, 'groups-groups-tab')
  await page.goto(`/feedback/${sourceId}?${scope}`)
  for (const [name, value] of [
    ['Summary', 'summary'],
    ['Settings', 'settings'],
    ['Items', 'items'],
  ]) {
    await page.getByRole('tab', { name, exact: true }).click()
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('tab') === value && url.searchParams.get('workspace') === 'projektor',
    )
    await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toContainText(
      value === 'items' ? feedbackBody : value === 'summary' ? 'acceptance-v1' : 'Created',
    )
    await checkpoint(page, testInfo, `feedback-tab-${value}`)
  }
  await page.goBack()
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true')
  await checkpoint(page, testInfo, 'feedback-history-settings')
  await page.goForward()
  await expect(page.getByRole('tab', { name: 'Items', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Items', exact: true })).toHaveAttribute('aria-selected', 'true')
  await checkpoint(page, testInfo, 'feedback-reloaded-items')
})

test('two real memberships require native selection and preserve workspace across mutation and navigation', async ({
  request,
  page,
}, testInfo) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toLowerCase()
  const slug = `second-${suffix}`
  const createdWorkspace = await request.post('http://127.0.0.1:4392/api/workspaces', {
    data: { name: `Second workspace ${suffix}`, slug },
  })
  expect(createdWorkspace.status(), await createdWorkspace.text()).toBe(201)
  const key = `C${suffix.toUpperCase()}`
  const projects: { id: string; name: string }[] = []
  for (const workspace of ['projektor', slug]) {
    const created = await request.post('http://127.0.0.1:4392/api/projects', {
      headers: { 'X-Workspace-Slug': workspace },
      data: { name: `Collision ${workspace}`, key },
    })
    expect(created.status(), await created.text()).toBe(201)
    projects.push(await created.json())
  }
  await page.goto(`/issues?project=${key}`)
  await expect(page.getByRole('heading', { name: 'Select a project', exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'ambiguous-project-key-no-default-tenant')
  await page.getByLabel('Project', { exact: true }).selectOption(projects[1].id)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('projectId') === projects[1].id)
  await expect(page.getByRole('heading', { name: 'Issues', exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'native-collision-project-selection')
  await page.goto('/')
  await page.getByText('+ New project', { exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveValue('')
  const projectName = `Second native ${suffix}`
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(projectName)
  await page.getByRole('textbox', { name: 'Key', exact: true }).fill(`N${suffix.toUpperCase()}`)
  await expect(page.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled()
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(slug)
  await checkpoint(page, testInfo, 'explicit-second-workspace-native-form')
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const link = page.getByRole('link').filter({ has: page.getByText(projectName, { exact: true }) })
  await expect(link).toHaveCount(1)
  expect(new URL((await link.getAttribute('href')) ?? '', page.url()).searchParams.get('workspace')).toBe(slug)
  await link.click()
  await expect(page.getByRole('heading', { name: projectName, exact: true, level: 1 })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: projectName, exact: true, level: 1 })).toBeVisible()
  await checkpoint(page, testInfo, 'second-workspace-native-create-reload')
  await page
    .getByRole('navigation', { name: 'Project sections' })
    .getByRole('link', { name: 'Issues', exact: true })
    .click()
  await expect(page).toHaveURL((url) => url.pathname === '/issues' && url.searchParams.get('workspace') === slug)
  await checkpoint(page, testInfo, 'second-workspace-native-issues-link')
  await page.goBack()
  await expect(page.getByRole('heading', { name: projectName, exact: true, level: 1 })).toBeVisible()
  await checkpoint(page, testInfo, 'second-workspace-history-overview')
  const mismatch = await request.get(`/issues?workspace=projektor&projectId=${projects[1].id}`)
  expect([403, 404]).toContain(mismatch.status())
  expect(await mismatch.text()).not.toContain(projects[1].name)
})
