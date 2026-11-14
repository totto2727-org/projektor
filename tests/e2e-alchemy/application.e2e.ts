import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'

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
    layout: {
      gap: number | null
      gutter: number | null
      sidebarBorder: string | null
      themeBorder: string | null
      tables: { width: number; rowWidth: number | null; display: string; wrap: string }[]
    }
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
  await page.evaluate(async () => {
    while (document.activeViewTransition) await document.activeViewTransition.finished
  })
  if (new URL(page.url()).pathname === '/settings/groups') {
    await expect(page.getByRole('heading', { name: 'Groups', level: 1 })).toBeVisible()
    await expect(page.getByText(/Groups grant members access to projects/)).toBeVisible()
  }
  const dimensions = await page.evaluate(() => ({
    innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  const viewportWidth = page.viewportSize()?.width
  expect(viewportWidth, 'Acceptance viewport must be explicit').toBeDefined()
  if (viewportWidth === undefined) throw new Error('Acceptance viewport must be explicit.')
  const layout = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.projektor-page-content')
    const nav = content?.querySelector<HTMLElement>(':scope > .projektor-project-nav')
    const pageContent = nav?.nextElementSibling
    const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar-container"]')
    const topbar = document.querySelector<HTMLElement>('.projektor-topbar')
    return {
      gap:
        nav && pageContent && !content?.hasAttribute('data-full-bleed')
          ? pageContent.getBoundingClientRect().top - nav.getBoundingClientRect().bottom
          : null,
      gutter: content ? Number.parseFloat(getComputedStyle(content).paddingTop) : null,
      sidebarBorder:
        sidebar && sidebar.getBoundingClientRect().width > 0 ? getComputedStyle(sidebar).borderRightColor : null,
      themeBorder: topbar ? getComputedStyle(topbar).borderBottomColor : null,
      tables: [...document.querySelectorAll('.markdown-content table')].map((table) => ({
        width: table.getBoundingClientRect().width,
        rowWidth: table.querySelector('tbody')?.getBoundingClientRect().width ?? null,
        display: getComputedStyle(table).display,
        wrap: getComputedStyle(table).overflowWrap,
      })),
    }
  })
  if (layout.gap !== null) {
    expect(layout.gutter, `${name}: page gutter must be positive`).toBeGreaterThan(0)
    expect(layout.gap, `${name}: content must not touch the project navigation border`).toBeCloseTo(layout.gutter!, 1)
  }
  if (layout.sidebarBorder !== null) {
    expect(layout.sidebarBorder, `${name}: sidebar divider must use the theme border color`).toBe(layout.themeBorder)
  }
  for (const table of layout.tables) {
    expect(table.display, `${name}: Markdown must preserve native table layout`).toBe('table')
    expect(table.wrap, `${name}: wide table cells must not collapse into single-letter columns`).toBe('normal')
    if (table.rowWidth !== null)
      expect(table.rowWidth, `${name}: Markdown rows must fill the table`).toBeCloseTo(table.width, 0)
  }
  observeBrowser(page, testInfo).checkpoints.push({
    name,
    url: page.url(),
    ...dimensions,
    viewportWidth,
    layout,
  })
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true })
  expect(dimensions.documentWidth, `${name}: document must fit viewport`).toBeLessThanOrEqual(dimensions.innerWidth)
  expect(dimensions.innerWidth, `${name}: layout viewport must not expand`).toBeLessThanOrEqual(viewportWidth)
  expect(dimensions.documentWidth, `${name}: document must fit configured viewport`).toBeLessThanOrEqual(viewportWidth)
}

test('API and Web share private Core persistence without adapter DB bindings', async ({ request, page }, testInfo) => {
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
  // Both actual adapters reach the same private Core through native service bindings.
  // Reapplying the Core-owned fixture ledger must not replay historical DDL or lose data.
  const migrationNames = (await readdir(new URL('../../migrations/', import.meta.url))).filter((name) =>
    /^\d{4}_.+\.sql$/.test(name),
  )
  expect(migrationNames.length).toBeGreaterThan(0)
  for (let attempt = 0; attempt < 2; attempt++) {
    const initialized = await request.post('http://127.0.0.1:4392/_fixture/reinitialize')
    expect(initialized.status(), await initialized.text()).toBe(200)
    expect(await initialized.json()).toEqual({ migrations: migrationNames.length })
  }
  const link = page.getByRole('link').filter({ has: page.getByText(name, { exact: true }) })
  await expect(link).toHaveCount(1)
  expect(new URL((await link.getAttribute('href')) ?? '', page.url()).searchParams.get('projectId')).toBe(project.id)
  await checkpoint(page, testInfo, 'api-write-core-web-read')
  await link.click()
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible()
  await checkpoint(page, testInfo, 'shared-db-project-reload')
})

test('My Issues uses one open-work table ordered by progress, priority and latest update', async ({
  request,
  page,
}, testInfo) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const headers = { 'X-Workspace-Slug': 'projektor' }
  const session = await request.get('http://127.0.0.1:4392/auth/me')
  expect(session.status()).toBe(200)
  const { user } = await session.json()
  const projects: { id: string; key: string; name: string }[] = []
  for (const prefix of ['A', 'B']) {
    const created = await request.post('http://127.0.0.1:4392/api/projects', {
      headers,
      data: { name: `Focus ${prefix} ${suffix}`, key: `${prefix}${suffix}` },
    })
    expect(created.status(), await created.text()).toBe(201)
    projects.push(await created.json())
  }
  const fixtures = [
    { title: 'Review first', status: 'in_review', priority: 'low', project: 1 },
    { title: 'Progress high old', status: 'in_progress', priority: 'high', project: 1 },
    { title: 'Progress low', status: 'in_progress', priority: 'low', project: 0 },
    { title: 'Todo urgent', status: 'todo', priority: 'urgent', project: 1 },
    { title: 'Todo high', status: 'todo', priority: 'high', project: 0 },
    { title: 'Backlog last', status: 'backlog', priority: 'urgent', project: 1 },
    { title: 'Completed hidden', status: 'done', priority: 'urgent', project: 0 },
    { title: 'Cancelled hidden', status: 'cancelled', priority: 'urgent', project: 1 },
  ]
  const create = async (fixture: (typeof fixtures)[number], assigned = true) => {
    const created = await request.post('http://127.0.0.1:4392/api/issues', {
      headers,
      data: {
        projectId: projects[fixture.project].id,
        title: `${fixture.title} ${suffix}`,
        status: fixture.status,
        priority: fixture.priority,
        ...(assigned ? { assigneeId: user.id } : {}),
      },
    })
    expect(created.status(), await created.text()).toBe(201)
  }
  for (const fixture of fixtures) await create(fixture)
  await create({ title: 'Unassigned hidden', status: 'todo', priority: 'urgent', project: 0 }, false)
  // API timestamps have second precision. Ensure the new equal-priority work has a later persisted update.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await create({ title: 'Progress high new', status: 'in_progress', priority: 'high', project: 0 })
  await page.goto('/my-issues?workspace=projektor')
  await expect(page.getByRole('heading', { name: 'My Issues', exact: true })).toBeVisible()
  await expect(page.locator('table')).toHaveCount(1)
  await expect(page.locator('table th')).toHaveText(['#', 'Title', 'Priority', 'Status'])
  for (const project of projects) await expect(page.getByRole('heading', { name: project.name })).toHaveCount(0)
  await expect(page.getByText('Include done', { exact: true })).toHaveCount(0)
  for (const title of ['Completed hidden', 'Cancelled hidden', 'Unassigned hidden'])
    await expect(page.getByRole('link', { name: `${title} ${suffix}`, exact: true })).toHaveCount(0)
  const expected = [
    'Review first',
    'Progress high new',
    'Progress high old',
    'Progress low',
    'Todo urgent',
    'Todo high',
    'Backlog last',
  ].map((title) => `${title} ${suffix}`)
  const titles = page.getByRole('link', { name: new RegExp(` ${suffix}$`) })
  await expect(titles).toHaveText(expected)
  for (const link of await titles.all())
    expect(new URL((await link.getAttribute('href')) ?? '', page.url()).searchParams.get('workspace')).toBe('projektor')
  await checkpoint(page, testInfo, 'my-issues-open-focus-order')
  await page.reload()
  await expect(titles).toHaveText(expected)
})

async function assertShell(page: Page) {
  await expect(page.locator('main#main-content')).toBeVisible()
  await expect(page.getByRole('link', { name: /skip to (main )?content/i })).toBeAttached()
  await expect(page.getByRole('button', { name: /^Account(?::|$)/ })).toBeVisible()
  const menu = page.locator('header.projektor-topbar').getByRole('button', { name: 'Toggle Sidebar', exact: true })
  if (await menu.isVisible()) {
    await menu.click()
    await expect(page.getByRole('list', { name: 'Primary navigation', exact: true })).toBeVisible()
    const modal = await page.locator('[data-slot="sidebar"][data-mobile="true"]').evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      height: element.getBoundingClientRect().height,
      viewportHeight: innerHeight,
    }))
    expect(modal.top).toBeCloseTo(0, 0)
    expect(modal.height).toBeCloseTo(modal.viewportHeight, 0)
    await page.keyboard.press('Escape')
    await expect(menu).toBeFocused()
  } else {
    await expect(page.getByRole('list', { name: 'Primary navigation', exact: true })).toBeVisible()
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('issue review targets persist optional selection and four statuses across focused views and issue summaries', async ({
  request,
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000)
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const headers = { 'X-Workspace-Slug': 'projektor' }
  const session = await request.get('http://127.0.0.1:4392/auth/me')
  expect(session.status()).toBe(200)
  const { user } = await session.json()
  const createdProject = await request.post('http://127.0.0.1:4392/api/projects', {
    headers,
    data: { name: `Review acceptance ${suffix}`, key: `V${suffix}` },
  })
  expect(createdProject.status(), await createdProject.text()).toBe(201)
  const project = await createdProject.json()
  const createIssue = async (title: string) => {
    const response = await request.post('http://127.0.0.1:4392/api/issues', {
      headers,
      data: { projectId: project.id, title, status: 'backlog', assigneeId: user.id },
    })
    expect(response.status(), await response.text()).toBe(201)
    return response.json()
  }
  const title = `Review target primary ${suffix}`
  const issue = await createIssue(title)
  const emptyIssue = await createIssue(`Review target empty ${suffix}`)
  const filename = `review-file-${suffix}.txt`
  const urlLabel = `Review design ${suffix}`
  const ordinaryLabel = `Ordinary reference ${suffix}`
  const uploaded = await request.post('http://127.0.0.1:4392/api/files', {
    headers,
    multipart: {
      file: { name: filename, mimeType: 'text/plain', buffer: Buffer.from('Real review attachment\n') },
      entityType: 'issue',
      entityId: issue.id,
    },
  })
  expect(uploaded.status(), await uploaded.text()).toBe(201)
  const uploadedAttachment = await uploaded.json()
  const attachmentFixtures: { id: string; filename: string }[] = [{ id: uploadedAttachment.id, filename }]
  for (const label of [urlLabel, ordinaryLabel]) {
    const linked = await request.post('http://127.0.0.1:4392/api/files/links', {
      headers,
      data: {
        entityType: 'issue',
        entityId: issue.id,
        kind: 'url',
        url: `https://example.com/${suffix}/${encodeURIComponent(label)}`,
        label,
      },
    })
    expect(linked.status(), await linked.text()).toBe(201)
    const linkedAttachment = await linked.json()
    attachmentFixtures.push({ id: linkedAttachment.id, filename: label })
  }
  const scope = new URLSearchParams({ workspace: 'projektor', projectId: project.id }).toString()
  await page.goto(`/issues/view?id=${emptyIssue.id}&${scope}`)
  await page.getByRole('button', { name: /Add URL/ }).click()
  const urlInput = page.getByPlaceholder('https://example.com/…', { exact: true })
  await urlInput.fill('https://[broken')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter a valid URL.')
  const browserUrl = `http://example.com/${suffix}/browser`
  const browserLabel = `Browser reference ${suffix}`
  await urlInput.fill(browserUrl)
  await page.getByPlaceholder('Label (optional)', { exact: true }).fill(browserLabel)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('link', { name: browserLabel, exact: true })).toHaveAttribute('href', browserUrl)
  await page.reload()
  await expect(page.getByRole('link', { name: browserLabel, exact: true })).toBeVisible()
  const browserAttachments = await request.get(
    `http://127.0.0.1:4392/api/files?entityType=issue&entityId=${emptyIssue.id}`,
    { headers },
  )
  expect(browserAttachments.status(), await browserAttachments.text()).toBe(200)
  expect(await browserAttachments.json()).toMatchObject([{ url: browserUrl, reviewStatus: null }])
  await checkpoint(page, testInfo, 'review-targets-browser-url-standard-validation')
  await page.goto(`/issues/view?id=${issue.id}&${scope}`)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  const issueUrl = page.url()
  const targets = page.getByRole('region', { name: 'レビュー対象', exact: true })
  const selected = (name: string) => targets.getByRole('checkbox', { name: `${name}をレビュー対象にする`, exact: true })
  const status = (name: string) => targets.getByRole('combobox', { name: `${name}のレビューステータス`, exact: true })
  for (const name of [filename, urlLabel, ordinaryLabel]) {
    await expect(selected(name)).not.toBeChecked()
    await expect(status(name)).toHaveCount(0)
  }
  await expect(targets.getByText('表示するレビュー対象はありません。', { exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'review-targets-default-optional')

  // These writes use the real browser ServerFn and private Core, not fixture SQL or API mutations.
  await selected(filename).click()
  await expect(status(filename)).toHaveValue('fixing')
  await expect(status(filename)).toBeEnabled()
  await expect(status(filename).locator('option')).toHaveText(['修正中', 'レビュー中', '要修正', '完了'])
  await page.reload()
  await expect(selected(filename)).toBeChecked()
  await expect(status(filename)).toHaveValue('fixing')
  await page.goto(`/issues?${scope}&view=list`)
  await expect(
    page.getByRole('link', { name: `Review targets: ${filename} (修正中)`, exact: true }).filter({ visible: true }),
  ).toContainText('レビュー不要')
  await page.goto(issueUrl)
  for (const [value, label] of [
    ['in_review', 'レビュー中'],
    ['changes_requested', '要修正'],
  ]) {
    await status(filename).selectOption(value)
    await expect(status(filename)).toHaveValue(value)
    await expect(status(filename)).toBeEnabled()
    await expect(
      targets
        .getByRole('listitem')
        .filter({ has: page.getByRole('checkbox', { name: `${filename}をレビュー対象にする`, exact: true }) })
        .locator('span')
        .filter({ hasText: new RegExp(`^${label}$`) }),
    ).toBeVisible()
    await page.reload()
    await expect(status(filename)).toHaveValue(value)
    await checkpoint(page, testInfo, `review-targets-persisted-${value}`)
  }
  await selected(filename).click()
  await expect(status(filename)).toHaveCount(0)
  await page.reload()
  await expect(selected(filename)).not.toBeChecked()
  const attachments = page.locator('section').filter({ has: page.getByText('Attachments (3)', { exact: true }) })
  await expect(attachments.getByRole('link', { name: filename, exact: true })).toBeVisible()
  await expect(attachments.getByRole('link', { name: ordinaryLabel, exact: true })).toBeVisible()

  await selected(filename).click()
  await expect(status(filename)).toBeEnabled()
  await selected(urlLabel).click()
  await expect(status(urlLabel)).toBeEnabled()
  await status(urlLabel).selectOption('in_review')
  await expect(status(urlLabel)).toBeEnabled()
  await page.reload()
  await expect(status(filename)).toHaveValue('fixing')
  await expect(status(urlLabel)).toHaveValue('in_review')
  await expect(selected(ordinaryLabel)).not.toBeChecked()
  const prioritySummary = `Review targets: ${urlLabel} +1 (レビュー中)`
  const routes = [
    { name: 'list', path: `/issues?${scope}&view=list` },
    { name: 'backlog', path: `/issues?${scope}&view=backlog` },
    { name: 'board', path: `/issues?${scope}&view=board` },
    { name: 'my-issues', path: '/my-issues?workspace=projektor' },
    { name: 'search', path: `/issues?${scope}&q=${suffix}` },
  ]
  for (const route of routes) {
    // Board intentionally excludes backlog. Move only the fixture's issue workflow,
    // leaving review selection and review statuses exclusively browser-mutated.
    if (route.name === 'board' || route.name === 'my-issues') {
      for (const fixture of [issue, emptyIssue]) {
        const moved = await request.patch(`http://127.0.0.1:4392/api/issues/${fixture.id}`, {
          headers,
          data: { status: route.name === 'board' ? 'todo' : 'backlog' },
        })
        expect(moved.status(), await moved.text()).toBe(200)
      }
    }
    await page.goto(route.path)
    const summary = page.getByRole('link', { name: prioritySummary, exact: true }).filter({ visible: true })
    await expect(summary).toHaveCount(1)
    await expect(summary).toContainText('+1')
    await expect(summary).not.toContainText('レビュー不要')
    await expect(
      page.getByRole('link', { name: 'Review targets: 対象なし', exact: true }).filter({ visible: true }).first(),
    ).toBeVisible()
    await checkpoint(page, testInfo, `review-targets-summary-${route.name}`)
    // Both the priority target and +N share a native focused-view link.
    await summary.getByText('+1', { exact: true }).click()
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('tab') === 'review-targets' && url.searchParams.get('workspace') === 'projektor',
    )
    await expect(targets.getByRole('heading', { name: 'レビュー対象 (2)', exact: true })).toBeVisible()
    await expect(status(urlLabel)).toHaveValue('in_review')
  }
  await status(filename).selectOption('in_review')
  await expect(status(filename)).toBeEnabled()
  await page.reload()
  await expect(targets.getByText('レビュー待ち: 2件', { exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'review-targets-focused-multiple-in-review')
  const focusedUrl = page.url()
  const coldContext = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: page.viewportSize() })
  try {
    const cold = await coldContext.newPage()
    observeBrowser(cold, testInfo)
    expect((await cold.goto(focusedUrl))?.status()).toBe(200)
    const coldTargets = cold.getByRole('region', { name: 'レビュー対象', exact: true })
    await expect(coldTargets.getByRole('heading', { name: 'レビュー対象 (2)', exact: true })).toBeVisible()
    await expect(coldTargets.getByText('レビュー待ち: 2件', { exact: true })).toBeVisible()
    await expect(coldTargets.getByRole('link', { name: filename, exact: true })).toBeVisible()
    await expect(coldTargets.getByRole('link', { name: urlLabel, exact: true })).toBeVisible()
    await expect(
      coldTargets.getByText('対象とステータスの変更にはJavaScriptが必要です。リンクから対象を開けます。', {
        exact: true,
      }),
    ).toBeVisible()
    await checkpoint(cold, testInfo, 'review-targets-cold-focused-no-js')
  } finally {
    await coldContext.close()
  }
  for (const name of [filename, urlLabel]) {
    await status(name).selectOption('done')
    await expect(status(name)).toHaveCount(0)
  }
  await page.goto(`/issues?${scope}&view=list`)
  const completedSummary = page
    .getByRole('link', { name: title, exact: true })
    .filter({ visible: true })
    .locator('..')
    .getByRole('link', { name: 'Review targets: 対象なし', exact: true })
  await expect(completedSummary).toBeVisible()
  await expect(completedSummary).not.toContainText('+1')
  await page.goto(issueUrl)
  await expect(status(filename)).toHaveCount(0)
  await expect(status(urlLabel)).toHaveCount(0)
  await expect(selected(filename)).toHaveCount(0)
  await expect(selected(urlLabel)).toHaveCount(0)
  await expect(targets.getByText('表示するレビュー対象はありません。', { exact: true })).toBeVisible()
  await expect(selected(ordinaryLabel)).not.toBeChecked()
  await expect(attachments.getByRole('link', { name: ordinaryLabel, exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'review-targets-complete-normal-attachments-preserved')

  // Completed targets are intentionally hidden in Web. The supported external
  // review API reopens them before each owning-issue terminal transition.
  for (const terminal of ['done', 'cancelled']) {
    const reopened = await request.patch(`http://127.0.0.1:4392/api/issues/${issue.id}`, {
      headers,
      data: { status: 'backlog' },
    })
    expect(reopened.status(), await reopened.text()).toBe(200)
    for (const attachment of attachmentFixtures.filter((entry) => entry.filename !== ordinaryLabel)) {
      const review = await request.patch(`http://127.0.0.1:4392/api/files/${attachment.id}/review-status`, {
        headers,
        data: { issueId: issue.id, status: 'in_review' },
      })
      expect(review.status(), await review.text()).toBe(200)
    }
    await page.reload()
    await expect(status(filename)).toHaveValue('in_review')
    await expect(status(urlLabel)).toHaveValue('in_review')
    const closed = await request.patch(`http://127.0.0.1:4392/api/issues/${issue.id}`, {
      headers,
      data: { status: terminal },
    })
    expect(closed.status(), await closed.text()).toBe(200)
    await page.reload()
    await expect(targets.getByText('表示するレビュー対象はありません。', { exact: true })).toBeVisible()
    for (const attachment of attachmentFixtures) {
      const metadata = await request.get(`http://127.0.0.1:4392/api/files/${attachment.id}/metadata`, { headers })
      expect(metadata.status(), await metadata.text()).toBe(200)
      expect(await metadata.json()).toMatchObject({
        id: attachment.id,
        filename: attachment.filename,
        reviewStatus: terminal === 'done' && attachment.filename !== ordinaryLabel ? 'done' : null,
      })
      await expect(attachments.getByRole('link', { name: attachment.filename, exact: true })).toBeVisible()
      await expect(status(attachment.filename)).toHaveCount(0)
      if (terminal === 'cancelled' || attachment.filename === ordinaryLabel) {
        await expect(selected(attachment.filename)).not.toBeChecked()
      } else {
        await expect(selected(attachment.filename)).toHaveCount(0)
      }
    }
    await checkpoint(page, testInfo, `review-targets-owner-${terminal}-attachments-preserved`)
  }
})

test('workspace review spans projects and unassigned issues with native filtered pagination and search', async ({
  request,
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000)
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const workspaceSlug = `review-${suffix.toLowerCase()}`
  const createdWorkspace = await request.post('http://127.0.0.1:4392/api/workspaces', {
    data: { name: `Cross review workspace ${suffix}`, slug: workspaceSlug },
  })
  expect(createdWorkspace.status(), await createdWorkspace.text()).toBe(201)
  const headers = { 'X-Workspace-Slug': workspaceSlug }
  const session = await request.get('http://127.0.0.1:4392/auth/me')
  expect(session.status()).toBe(200)
  const { user } = await session.json()
  const projects: { id: string; key: string; name: string }[] = []
  for (const prefix of ['A', 'B']) {
    const created = await request.post('http://127.0.0.1:4392/api/projects', {
      headers,
      data: { name: `Cross project ${prefix} ${suffix}`, key: `${prefix}${suffix}` },
    })
    expect(created.status(), await created.text()).toBe(201)
    projects.push(await created.json())
  }
  const cases = [
    { tag: 'Review assigned', project: 0, review: 'in_review', assigned: true },
    { tag: 'Review unassigned', project: 1, review: 'in_review', assigned: false },
    { tag: 'Fixing', project: 0, review: 'fixing', assigned: false },
    { tag: 'Changes requested', project: 1, review: 'changes_requested', assigned: true },
    { tag: 'Completed target', project: 0, review: 'done', assigned: false },
    { tag: 'Ordinary newest', project: 1, review: null, assigned: false },
  ]
  const issues: {
    id: string
    number: number
    title: string
    targetLabel: string
    review: string | null
    project: (typeof projects)[number]
  }[] = []
  for (const fixture of cases) {
    const project = projects[fixture.project]
    const title = `Cross review ${suffix} ${fixture.tag}`
    const created = await request.post('http://127.0.0.1:4392/api/issues', {
      headers,
      data: { projectId: project.id, title, status: 'backlog', ...(fixture.assigned ? { assigneeId: user.id } : {}) },
    })
    expect(created.status(), await created.text()).toBe(201)
    const issue = await created.json()
    const targetLabel = `${fixture.tag} target ${suffix}`
    if (fixture.review !== null) {
      const linked = await request.post('http://127.0.0.1:4392/api/files/links', {
        headers,
        data: {
          kind: 'url',
          entityType: 'issue',
          entityId: issue.id,
          url: `https://example.com/cross-review/${issue.id}`,
          label: targetLabel,
        },
      })
      expect(linked.status(), await linked.text()).toBe(201)
      const attachment = await linked.json()
      const selected = await request.patch(`http://127.0.0.1:4392/api/files/${attachment.id}/review-status`, {
        headers,
        data: { issueId: issue.id, status: fixture.review },
      })
      expect(selected.status(), await selected.text()).toBe(200)
    }
    issues.push({ id: issue.id, number: issue.number, title, targetLabel, review: fixture.review, project })
  }
  const visibleTitles = () =>
    page.getByRole('link', { name: new RegExp(`^Cross review ${suffix} `) }).filter({ visible: true })
  const assertReviewResults = async (review: string) => {
    const expected = issues.filter((issue) =>
      review === 'active' ? issue.review !== null && issue.review !== 'done' : issue.review === review,
    )
    await expect(visibleTitles()).toHaveCount(expected.length)
    for (const issue of issues) {
      const link = page.getByRole('link', { name: issue.title, exact: true }).filter({ visible: true })
      if (expected.includes(issue)) await expect(link).toBeVisible()
      else await expect(link).toHaveCount(0)
    }
  }
  await page.goto(`/issues?workspace=${workspaceSlug}&projectId=${projects[0].id}`)
  await expect(page.getByText(`表示範囲: ${projects[0].key} · ${projects[0].name}`, { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '全プロジェクトのレビュー', exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get('workspace') === workspaceSlug &&
      url.searchParams.get('review') === 'in_review' &&
      !url.searchParams.has('projectId') &&
      !url.searchParams.has('project'),
  )
  await expect(page.getByText('表示範囲: アクセスできる全プロジェクト', { exact: true })).toBeVisible()
  await assertReviewResults('in_review')
  const reviewUrl = page.url()
  for (const issue of issues.filter((entry) => entry.review === 'in_review')) {
    await expect(
      page.getByText(`${issue.project.key}-${issue.number}`, { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    const summary = page
      .getByRole('link', { name: `Review targets: ${issue.targetLabel} (レビュー中)`, exact: true })
      .filter({ visible: true })
    await summary.click()
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('workspace') === workspaceSlug &&
        url.searchParams.get('tab') === 'review-targets' &&
        url.pathname.startsWith(`/projects/${issue.project.key}/issues/${issue.number}/`),
    )
    await expect(page.getByRole('heading', { name: issue.title, exact: true })).toBeVisible()
    await expect(page.getByText(issue.project.name, { exact: true }).filter({ visible: true })).toBeVisible()
    await page.goto(reviewUrl)
  }
  await checkpoint(page, testInfo, 'cross-project-review-assigned-and-unassigned')

  const paged = new URL(reviewUrl)
  paged.searchParams.set('limit', '1')
  await page.goto(paged.href)
  await expect(visibleTitles()).toHaveCount(1)
  const firstTitle = await visibleTitles().innerText()
  const pagination = page.getByRole('navigation', { name: 'Issue pagination', exact: true })
  await pagination.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.has('cursor') &&
      url.searchParams.get('review') === 'in_review' &&
      url.searchParams.get('limit') === '1',
  )
  await expect(visibleTitles()).toHaveCount(1)
  await expect(visibleTitles()).not.toHaveText(firstTitle)
  await expect(pagination.getByRole('link', { name: 'First page', exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'cross-project-review-native-next-page')

  const tabs = page.getByRole('navigation', { name: 'レビューステータスで課題を絞り込む', exact: true })
  await tabs.getByRole('link', { name: '修正中', exact: true }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('review') === 'fixing' && !url.searchParams.has('cursor'))
  await assertReviewResults('fixing')
  const fullPage = new URL(page.url())
  fullPage.searchParams.set('limit', '30')
  await page.goto(fullPage.href)
  for (const [review, label] of [
    ['in_review', 'レビュー中'],
    ['fixing', '修正中'],
    ['changes_requested', '要修正'],
    ['active', '未完了の対象'],
  ]) {
    await tabs.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL((url) => url.searchParams.get('review') === review && !url.searchParams.has('cursor'))
    await expect(tabs.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
    await assertReviewResults(review)
    await page.getByRole('searchbox', { name: 'Search issues', exact: true }).fill(suffix)
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('q') === suffix && url.searchParams.get('review') === review,
    )
    await assertReviewResults(review)
    await page.reload()
    await assertReviewResults(review)
    await checkpoint(page, testInfo, `cross-project-review-search-${review}`)
  }
  const coldContext = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: page.viewportSize() })
  try {
    const cold = await coldContext.newPage()
    observeBrowser(cold, testInfo)
    expect((await cold.goto(page.url()))?.status()).toBe(200)
    for (const issue of issues) {
      const link = cold.getByRole('link', { name: issue.title, exact: true }).filter({ visible: true })
      if (issue.review !== null && issue.review !== 'done') await expect(link).toBeVisible()
      else await expect(link).toHaveCount(0)
    }
    await cold
      .getByRole('navigation', { name: 'レビューステータスで課題を絞り込む', exact: true })
      .getByRole('link', { name: '要修正', exact: true })
      .click()
    await expect(cold).toHaveURL(
      (url) => url.searchParams.get('review') === 'changes_requested' && url.searchParams.get('q') === suffix,
    )
    await expect(
      cold
        .getByRole('link', { name: `Cross review ${suffix} Changes requested`, exact: true })
        .filter({ visible: true }),
    ).toBeVisible()
    await checkpoint(cold, testInfo, 'cross-project-review-cold-no-js-native-tab')
  } finally {
    await coldContext.close()
  }
})

test('shared Recharts render raw CFD bands and Wiki mobile drawer leaves the header in front', async ({
  request,
  page,
}, testInfo) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const headers = { 'X-Workspace-Slug': 'projektor' }
  const created = await request.post('http://127.0.0.1:4392/api/projects', {
    headers,
    data: { name: `Chart acceptance ${suffix}`, key: `C${suffix}` },
  })
  expect(created.status(), await created.text()).toBe(201)
  const project = await created.json()
  const query = new URLSearchParams({ projectId: project.id, workspace: 'projektor' })
  expect((await page.goto(`/projects/view?${query}`))?.status()).toBe(200)
  await expect(page.getByText('No issues in this window yet', { exact: true })).toBeVisible()
  await expect(page.getByTestId('flow-chart-cfd')).toHaveCount(0)
  await checkpoint(page, testInfo, 'charts-empty-no-zero-band')

  // Public API transitions stamp the persisted timestamps read through Core by Web.
  // No DB edits, client props injection or chart implementation mocks.
  for (const [index, status] of ['backlog', 'in_progress', 'in_progress', 'in_review', 'done'].entries()) {
    const issueResponse = await request.post('http://127.0.0.1:4392/api/issues', {
      headers,
      data: { projectId: project.id, title: `Chart issue ${index} ${suffix}` },
    })
    expect(issueResponse.status(), await issueResponse.text()).toBe(201)
    const issue = await issueResponse.json()
    if (status !== 'backlog') {
      const updated = await request.patch(`http://127.0.0.1:4392/api/issues/${issue.id}`, {
        headers,
        data: { status },
      })
      expect(updated.status(), await updated.text()).toBe(200)
    }
  }
  const metricsResponse = await request.get(`http://127.0.0.1:4392/api/projects/${project.id}/flow-metrics`, {
    headers,
  })
  expect(metricsResponse.status(), await metricsResponse.text()).toBe(200)
  const metrics = await metricsResponse.json()
  expect(metrics.cfdOverTime.at(-1)).toMatchObject({ backlogTodo: 1, inProgress: 2, inReview: 1, done: 1 })
  await testInfo.attach('chart-api-data', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
  await page.reload()
  const chart = page.getByTestId('flow-chart-cfd')
  const areas = chart.locator('.recharts-area-area')
  await expect(areas).toHaveCount(4)
  for (const area of await areas.all()) {
    await expect(area).toHaveAttribute('d', /[zZ]$/)
    expect(await area.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0)
  }
  for (const label of ['Backlog/todo', 'In progress', 'In review', 'Done'])
    await expect(chart.getByText(label, { exact: true })).toBeVisible()
  await expect(page.getByTestId('flow-chart-throughput').locator('.recharts-bar-rectangle')).not.toHaveCount(0)
  await checkpoint(page, testInfo, 'charts-overview-filled-bands')
  const surface = chart.locator('svg.recharts-surface')
  const box = await surface.boundingBox()
  if (!box) throw new Error('CFD chart has no rendered surface')
  await page.mouse.move(box.x + box.width - 15, box.y + 80)
  const tooltip = chart.locator('.recharts-tooltip-wrapper')
  await expect(tooltip).toBeVisible()
  await expect(tooltip.getByText('In progress', { exact: true }).locator('../..')).toHaveText(/In progress\s*2$/)
  await expect(tooltip.getByText('Backlog/todo', { exact: true }).locator('../..')).toHaveText(/Backlog\/todo\s*1$/)
  await checkpoint(page, testInfo, 'charts-tooltip-raw-not-cumulative')
  await page.mouse.move(0, 0)
  const lightFill = await areas.last().evaluate((element) => getComputedStyle(element).fill)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => areas.last().evaluate((element) => getComputedStyle(element).fill)).not.toBe(lightFill)
  await checkpoint(page, testInfo, 'charts-system-dark-theme')
  await page.emulateMedia({ colorScheme: 'light' })
  expect((await page.goto(`/metrics?${query}`))?.status()).toBe(200)
  await expect(page.getByTestId('flow-chart-cfd').locator('.recharts-area-area')).toHaveCount(4)
  await checkpoint(page, testInfo, 'charts-metrics-shared-cfd')

  const wikiResponse = await request.post('http://127.0.0.1:4392/api/wiki', {
    headers,
    data: {
      projectId: project.id,
      title: `Drawer acceptance ${suffix}`,
      slug: `drawer-${suffix.toLowerCase()}`,
      content: Array.from(
        { length: 30 },
        (_, index) => `## Section ${index}\n\nScrollable persisted page content.`,
      ).join('\n\n'),
    },
  })
  expect(wikiResponse.status(), await wikiResponse.text()).toBe(201)
  expect((await page.goto(`/wiki/view?${query}&slug=drawer-${suffix.toLowerCase()}`))?.status()).toBe(200)
  if (testInfo.project.name === 'mobile') {
    const trigger = page.getByRole('button', { name: 'Pages', exact: true })
    const drawer = page.locator('.wiki-sidebar.wiki-sidebar-open')
    const backdrop = page.locator('.wiki-drawer-overlay-open')
    await trigger.click()
    await expect(drawer).toBeVisible()
    const assertHeaderLayer = async () => {
      const layers = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>('.projektor-topbar')!
        const overlay = document.querySelector<HTMLElement>('.wiki-drawer-overlay-open')!
        const sidebar = document.querySelector<HTMLElement>('.wiki-sidebar-open')!
        const rect = header.getBoundingClientRect()
        return {
          headerBottom: rect.bottom,
          overlayTop: overlay.getBoundingClientRect().top,
          drawerTop: sidebar.getBoundingClientRect().top,
          headerZ: Number(getComputedStyle(header).zIndex),
          overlayZ: Number(getComputedStyle(overlay).zIndex),
          drawerZ: Number(getComputedStyle(sidebar).zIndex),
          headerHit: Boolean(
            document
              .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
              ?.closest('.projektor-topbar'),
          ),
        }
      })
      expect(layers.overlayTop).toBeCloseTo(layers.headerBottom, 0)
      expect(layers.drawerTop).toBeCloseTo(layers.headerBottom, 0)
      expect(layers.headerZ).toBeGreaterThan(layers.drawerZ)
      expect(layers.headerZ).toBeGreaterThan(layers.overlayZ)
      expect(layers.headerHit).toBe(true)
      await testInfo.attach('wiki-layer-observation', { body: JSON.stringify(layers), contentType: 'application/json' })
    }
    await assertHeaderLayer()
    await checkpoint(page, testInfo, 'wiki-drawer-header-in-front')
    await page.mouse.wheel(0, 300)
    await assertHeaderLayer()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(drawer).toBeVisible()
    await backdrop.click({ position: { x: 350, y: 100 } })
    await expect(drawer).toHaveCount(0)
    await checkpoint(page, testInfo, 'wiki-drawer-backdrop-close')
    await assertShell(page)
  }
})

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
  const issueBody = `Native Core-backed update ${suffix}`
  await page.getByTitle('Edit description', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Markdown editor', exact: true }).fill(issueBody)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(issueBody, { exact: true })).toBeVisible()
  await expect(page.locator('.markdown-content').getByText(issueBody, { exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-updated-canonical-body')
  await page.reload()
  await expect(page.getByText(issueBody, { exact: true })).toBeVisible()
  await expect(page.locator('.markdown-content').getByText(issueBody, { exact: true })).toBeVisible()
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
    `## Comark acceptance ${suffix}\n\nA **strong** native paragraph.\n\n- One\n- Two\n\n| Surface | Status |\n| --- | --- |\n| Web | Ready |\n\n\`\`\`ts\nconst ready = true\n\`\`\`\n\n[Scoped project](${projectUrl})\n\n<script>window.__acceptanceInjected = true</script>`,
  )
  await checkpoint(page, testInfo, 'native-wiki-form')
  await page.getByRole('button', { name: 'Create page', exact: true }).click()
  await expect(page.getByRole('heading', { name: wikiTitle, exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: `Comark acceptance ${suffix}`, exact: true, level: 2 })).toBeVisible()
  await expect(page.locator('.markdown-content table')).toBeVisible()
  await expect(page.locator('.markdown-content pre.shiki')).toBeVisible()
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
  // Reciprocal file parity: both real adapters delegate to private Core.
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
