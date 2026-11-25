import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import { Iterable, Predicate } from 'effect'

import { HTTP_FORBIDDEN, HTTP_CREATED, HTTP_NOT_FOUND, HTTP_OK } from '#contracts/http-status.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { runInOrder } from '#tests/run-effect.ts'

import { createReaderFixtures } from './reader-fixtures.ts'

interface BrowserAudit {
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

const observeBrowser = function observeBrowser(page: Page, testInfo: TestInfo): BrowserAudit {
  const existing = pageAudits.get(page)
  if (existing) {
    return existing
  }
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
    if (message.type() === 'error') {
      audit.consoleErrors.push(message.text())
    }
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
  Iterable.forEach(audits, (audit) => {
    expect(audit.pageErrors, 'Browser pageerror including hydration').toEqual([])
    expect(audit.consoleErrors, 'Browser console.error including hydration').toEqual([])
    expect(audit.directApiRequests, 'Browser must not use direct /api fetch or XHR').toEqual([])
  })
})

const waitForViewTransitions = async function waitForViewTransitions(): Promise<void> {
  if (document.activeViewTransition) {
    await document.activeViewTransition.finished
    await waitForViewTransitions()
  }
}

const checkpoint = async function checkpoint(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(waitForViewTransitions)
  if (new URL(page.url()).pathname === '/settings/groups') {
    await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible()
    await expect(page.getByText(/Groups grant members access to projects/u)).toBeVisible()
  }
  const dimensions = await page.evaluate(() => ({
    innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }))
  const viewportWidth = page.viewportSize()?.width
  expect(viewportWidth, 'Acceptance viewport must be explicit').toBeDefined()
  if (Predicate.isNullish(viewportWidth)) {
    throw new Error('Acceptance viewport must be explicit.')
  }
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
  if (Predicate.isNotNullish(layout.gap)) {
    expect(layout.gutter, `${name}: page gutter must be positive`).toBeGreaterThan(0)
    expect(layout.gap, `${name}: content must not touch the project navigation border`).toBeCloseTo(layout.gutter!, 1)
  }
  if (Predicate.isNotNullish(layout.sidebarBorder)) {
    expect(layout.sidebarBorder, `${name}: sidebar divider must use the theme border color`).toBe(layout.themeBorder)
  }
  Iterable.forEach(layout.tables, (table) => {
    expect(table.display, `${name}: Markdown must preserve native table layout`).toBe('table')
    expect(table.wrap, `${name}: wide table cells must not collapse into single-letter columns`).toBe('normal')
    if (Predicate.isNotNullish(table.rowWidth)) {
      expect(table.rowWidth, `${name}: Markdown rows must fill the table`).toBeCloseTo(table.width, 0)
    }
  })
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

const verifyMigrationReplay = async function verifyMigrationReplay(
  request: APIRequestContext,
  expectedMigrations: number,
): Promise<void> {
  const initialized = await request.post('http://127.0.0.1:4392/_fixture/reinitialize')
  expect(initialized.status(), await initialized.text()).toBe(HTTP_OK)
  expect(await initialized.json()).toEqual({ migrations: expectedMigrations })
}

test('API and Web share private Core persistence without adapter DB bindings', async ({ request, page }, testInfo) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const name = `Shared D1 ${suffix}`
  const write = await request.post('http://127.0.0.1:4392/api/projects', {
    headers: { 'X-Workspace-Slug': 'projektor' },
    data: { name, key: `D${suffix}` },
  })
  expect(write.status(), await write.text()).toBe(HTTP_CREATED)
  const project = await write.json()
  expect(project.id).toBeTruthy()
  const response = await page.goto('/?workspace=projektor')
  expect(response?.status()).toBe(HTTP_OK)
  // Both actual adapters reach the same private Core through native service bindings.
  // Reapplying the Core-owned fixture ledger must not replay historical DDL or lose data.
  const migrationNamesResult = await readdir(new URL('../../migrations/', import.meta.url))
  const migrationNames = migrationNamesResult.filter((migrationName) => /^\d{4}_.+\.sql$/u.test(migrationName))
  expect(migrationNames.length).toBeGreaterThan(0)
  await verifyMigrationReplay(request, migrationNames.length)
  await verifyMigrationReplay(request, migrationNames.length)
  const link = page.getByRole('link').filter({ has: page.getByText(name, { exact: true }) })
  await expect(link).toHaveCount(1)
  expect(new URL((await link.getAttribute('href')) ?? '', page.url()).searchParams.get('projectId')).toBe(project.id)
  await checkpoint(page, testInfo, 'api-write-core-web-read')
  await link.click()
  await expect(page.getByRole('heading', { exact: true, level: 1, name })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { exact: true, level: 1, name })).toBeVisible()
  await checkpoint(page, testInfo, 'shared-db-project-reload')
})

test('My Issues uses one open-work table ordered by progress, priority and latest update', async ({
  request,
  page,
}, testInfo) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()
  const headers = { 'X-Workspace-Slug': 'projektor' }
  const session = await request.get('http://127.0.0.1:4392/auth/me')
  expect(session.status()).toBe(HTTP_OK)
  const { user } = await session.json()
  const projects: { id: string; key: string; name: string }[] = []
  await runInOrder(['A', 'B'], async (prefix): Promise<void> => {
    const created = await request.post('http://127.0.0.1:4392/api/projects', {
      headers,
      data: { name: `Focus ${prefix} ${suffix}`, key: `${prefix}${suffix}` },
    })
    expect(created.status(), await created.text()).toBe(HTTP_CREATED)
    projects.push(await created.json())
  })
  const fixtures = [
    { priority: 'low', project: 1, status: 'in_review', title: 'Review first' },
    { priority: 'high', project: 1, status: 'in_progress', title: 'Progress high old' },
    { priority: 'low', project: 0, status: 'in_progress', title: 'Progress low' },
    { priority: 'urgent', project: 1, status: 'todo', title: 'Todo urgent' },
    { priority: 'high', project: 0, status: 'todo', title: 'Todo high' },
    { priority: 'urgent', project: 1, status: 'backlog', title: 'Backlog last' },
    { priority: 'urgent', project: 0, status: 'done', title: 'Completed hidden' },
    { priority: 'urgent', project: 1, status: 'cancelled', title: 'Cancelled hidden' },
  ]
  const create = async (fixture: (typeof fixtures)[number], assigned = true): Promise<void> => {
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
    expect(created.status(), await created.text()).toBe(HTTP_CREATED)
  }
  await runInOrder(fixtures, async (fixture): Promise<void> => {
    await create(fixture)
  })
  await create({ priority: 'urgent', project: 0, status: 'todo', title: 'Unassigned hidden' }, false)
  // API timestamps have second precision. Ensure the new equal-priority work has a later persisted update.
  await new Promise((resolve) => {
    setTimeout(resolve, 1100)
  })
  await create({ priority: 'high', project: 0, status: 'in_progress', title: 'Progress high new' })
  await page.goto('/my-issues?workspace=projektor')
  await expect(page.getByRole('heading', { exact: true, name: 'My Issues' })).toBeVisible()
  await expect(page.locator('table')).toHaveCount(1)
  await expect(page.locator('table th')).toHaveText(['#', 'Title', 'Priority', 'Status'])
  await runInOrder(projects, async (project): Promise<void> => {
    await expect(page.getByRole('heading', { name: project.name })).toHaveCount(0)
  })
  await expect(page.getByText('Include done', { exact: true })).toHaveCount(0)
  await runInOrder(['Completed hidden', 'Cancelled hidden', 'Unassigned hidden'], async (title): Promise<void> => {
    await expect(page.getByRole('link', { exact: true, name: `${title} ${suffix}` })).toHaveCount(0)
  })
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
  await runInOrder(await titles.all(), async (link): Promise<void> => {
    expect(new URL((await link.getAttribute('href')) ?? '', page.url()).searchParams.get('workspace')).toBe('projektor')
  })
  await checkpoint(page, testInfo, 'my-issues-open-focus-order')
  await page.reload()
  await expect(titles).toHaveText(expected)
})

const assertShell = async function assertShell(page: Page): Promise<void> {
  await expect(page.locator('main#main-content')).toBeVisible()
  await expect(page.getByRole('link', { name: /skip to (main )?content/i })).toBeAttached()
  await expect(page.getByRole('button', { name: /^Account(?::|$)/u })).toBeVisible()
  const menu = page.locator('header.projektor-topbar').getByRole('button', { exact: true, name: 'Toggle Sidebar' })
  if (await menu.isVisible()) {
    await menu.click()
    await expect(page.getByRole('list', { exact: true, name: 'Primary navigation' })).toBeVisible()
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
    await expect(page.getByRole('list', { exact: true, name: 'Primary navigation' })).toBeVisible()
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
  expect(session.status()).toBe(HTTP_OK)
  const { user } = await session.json()
  const createdProject = await request.post('http://127.0.0.1:4392/api/projects', {
    headers,
    data: { name: `Review acceptance ${suffix}`, key: `V${suffix}` },
  })
  expect(createdProject.status(), await createdProject.text()).toBe(HTTP_CREATED)
  const project = await createdProject.json()
  const createIssue = async (title: string) => {
    const response = await request.post('http://127.0.0.1:4392/api/issues', {
      headers,
      data: { projectId: project.id, title, status: 'backlog', assigneeId: user.id },
    })
    expect(response.status(), await response.text()).toBe(HTTP_CREATED)
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
  expect(uploaded.status(), await uploaded.text()).toBe(HTTP_CREATED)
  const uploadedAttachment = await uploaded.json()
  const attachmentFixtures: { id: string; filename: string }[] = [{ id: uploadedAttachment.id, filename }]
  await runInOrder([urlLabel, ordinaryLabel], async (label): Promise<void> => {
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
    expect(linked.status(), await linked.text()).toBe(HTTP_CREATED)
    const linkedAttachment = await linked.json()
    attachmentFixtures.push({ id: linkedAttachment.id, filename: label })
  })
  const scope = new URLSearchParams({ workspace: 'projektor', projectId: project.id }).toString()
  const emptyIssueUrl = `/issues/view?id=${emptyIssue.id}&${scope}`
  await page.goto(emptyIssueUrl)
  await page.getByRole('button', { name: /Add URL/u }).click()
  const urlInput = page.getByPlaceholder('https://example.com/…', { exact: true })
  await urlInput.fill('https://[broken')
  await page.getByRole('button', { exact: true, name: 'Add' }).click()
  await expect(page.getByRole('alert')).toHaveText('Enter a valid URL.')
  const browserUrl = `http://example.com/${suffix}/browser`
  const browserLabel = `Browser reference ${suffix}`
  await urlInput.fill(browserUrl)
  await page.getByPlaceholder('Label (optional)', { exact: true }).fill(browserLabel)
  await page.getByRole('button', { exact: true, name: 'Add' }).click()
  await expect(page.getByRole('link', { exact: true, name: browserLabel })).toHaveAttribute('href', browserUrl)
  await page.reload()
  await expect(page.getByRole('link', { exact: true, name: browserLabel })).toBeVisible()
  const browserAttachments = await request.get(
    `http://127.0.0.1:4392/api/files?entityType=issue&entityId=${emptyIssue.id}`,
    { headers },
  )
  expect(browserAttachments.status(), await browserAttachments.text()).toBe(HTTP_OK)
  expect(await browserAttachments.json()).toMatchObject([{ url: browserUrl, reviewStatus: null }])
  await checkpoint(page, testInfo, 'review-targets-browser-url-standard-validation')
  await page.goto(`/issues/view?id=${issue.id}&${scope}`)
  await expect(page.getByRole('heading', { exact: true, name: title })).toBeVisible()
  const issueUrl = page.url()
  const targets = page.getByRole('region', { exact: true, name: 'レビュー対象' })
  const selected = (name: string): Locator =>
    targets.getByRole('checkbox', { exact: true, name: `${name}をレビュー対象にする` })
  const status = (name: string): Locator =>
    targets.getByRole('combobox', { exact: true, name: `${name}のレビューステータス` })
  await runInOrder([filename, urlLabel, ordinaryLabel], async (name): Promise<void> => {
    await expect(selected(name)).not.toBeChecked()
    await expect(status(name)).toHaveCount(0)
  })
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
    page.getByRole('link', { exact: true, name: `Review targets: ${filename} (修正中)` }).filter({ visible: true }),
  ).toContainText('レビュー不要')
  await page.goto(issueUrl)
  await runInOrder(
    [
      ['in_review', 'レビュー中'],
      ['changes_requested', '要修正'],
    ],
    async ([value, label]): Promise<void> => {
      await status(filename).selectOption(value)
      await expect(status(filename)).toHaveValue(value)
      await expect(status(filename)).toBeEnabled()
      await expect(
        targets
          .getByRole('listitem')
          .filter({ has: page.getByRole('checkbox', { exact: true, name: `${filename}をレビュー対象にする` }) })
          .locator('span')
          .filter({ hasText: new RegExp(`^${label}$`) }),
      ).toBeVisible()
      await page.reload()
      await expect(status(filename)).toHaveValue(value)
      await checkpoint(page, testInfo, `review-targets-persisted-${value}`)
    },
  )
  await selected(filename).click()
  await expect(status(filename)).toHaveCount(0)
  await page.reload()
  await expect(selected(filename)).not.toBeChecked()
  const attachments = page.locator('section').filter({ has: page.getByText('Attachments (3)', { exact: true }) })
  await expect(attachments.getByRole('link', { exact: true, name: filename })).toBeVisible()
  await expect(attachments.getByRole('link', { exact: true, name: ordinaryLabel })).toBeVisible()

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
  await runInOrder(routes, async (route): Promise<void> => {
    /*
     * Board intentionally excludes backlog. Move only the fixture's issue workflow,
     * leaving review selection and review statuses exclusively browser-mutated.
     */
    if (route.name === 'board' || route.name === 'my-issues') {
      await runInOrder([issue, emptyIssue], async (fixture): Promise<void> => {
        const moved = await request.patch(`http://127.0.0.1:4392/api/issues/${fixture.id}`, {
          headers,
          data: { status: route.name === 'board' ? 'todo' : 'backlog' },
        })
        expect(moved.status(), await moved.text()).toBe(HTTP_OK)
      })
    }
    await page.goto(route.path)
    const summary = page.getByRole('link', { exact: true, name: prioritySummary }).filter({ visible: true })
    await expect(summary).toHaveCount(1)
    await expect(summary).toContainText('+1')
    await expect(summary).not.toContainText('レビュー不要')
    await expect(
      page.getByRole('link', { exact: true, name: 'Review targets: 対象なし' }).filter({ visible: true }).first(),
    ).toBeVisible()
    await checkpoint(page, testInfo, `review-targets-summary-${route.name}`)
    // Both the priority target and +N share a native focused-view link.
    await summary.getByText('+1', { exact: true }).click()
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('tab') === 'review-targets' && url.searchParams.get('workspace') === 'projektor',
    )
    await expect(targets.getByRole('heading', { exact: true, name: 'レビュー対象 (2)' })).toBeVisible()
    await expect(status(urlLabel)).toHaveValue('in_review')
  })
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
    const focusedPageResponse = await cold.goto(focusedUrl)
    expect(focusedPageResponse?.status()).toBe(HTTP_OK)
    const coldTargets = cold.getByRole('region', { exact: true, name: 'レビュー対象' })
    await expect(coldTargets.getByRole('heading', { exact: true, name: 'レビュー対象 (2)' })).toBeVisible()
    await expect(coldTargets.getByText('レビュー待ち: 2件', { exact: true })).toBeVisible()
    await expect(coldTargets.getByRole('link', { exact: true, name: filename })).toBeVisible()
    await expect(coldTargets.getByRole('link', { exact: true, name: urlLabel })).toBeVisible()
    await expect(
      coldTargets.getByText('対象とステータスの変更にはJavaScriptが必要です。リンクから対象を開けます。', {
        exact: true,
      }),
    ).toBeVisible()
    await checkpoint(cold, testInfo, 'review-targets-cold-focused-no-js')
    const emptyIssueResponse = await cold.goto(emptyIssueUrl)
    expect(emptyIssueResponse?.status()).toBe(HTTP_OK)
    await expect(cold.getByRole('button', { name: /Add URL/u })).toBeDisabled()
  } finally {
    await coldContext.close()
  }
  await runInOrder([filename, urlLabel], async (name): Promise<void> => {
    await status(name).selectOption('done')
    await expect(status(name)).toHaveCount(0)
  })
  await page.goto(`/issues?${scope}&view=list`)
  const completedSummary = page
    .getByRole('link', { exact: true, name: title })
    .filter({ visible: true })
    .locator('..')
    .getByRole('link', { exact: true, name: 'Review targets: 対象なし' })
  await expect(completedSummary).toBeVisible()
  await expect(completedSummary).not.toContainText('+1')
  await page.goto(issueUrl)
  await expect(status(filename)).toHaveCount(0)
  await expect(status(urlLabel)).toHaveCount(0)
  await expect(selected(filename)).toHaveCount(0)
  await expect(selected(urlLabel)).toHaveCount(0)
  await expect(targets.getByText('表示するレビュー対象はありません。', { exact: true })).toBeVisible()
  await expect(selected(ordinaryLabel)).not.toBeChecked()
  await expect(attachments.getByRole('link', { exact: true, name: ordinaryLabel })).toBeVisible()
  await checkpoint(page, testInfo, 'review-targets-complete-normal-attachments-preserved')

  /*
   * Completed targets are intentionally hidden in Web. The supported external
   * review API reopens them before each owning-issue terminal transition.
   */
  await runInOrder(['done', 'cancelled'], async (terminal): Promise<void> => {
    const reopened = await request.patch(`http://127.0.0.1:4392/api/issues/${issue.id}`, {
      headers,
      data: { status: 'backlog' },
    })
    expect(reopened.status(), await reopened.text()).toBe(HTTP_OK)
    await runInOrder(
      attachmentFixtures.filter((entry) => entry.filename !== ordinaryLabel),
      async (attachment): Promise<void> => {
        const review = await request.patch(`http://127.0.0.1:4392/api/files/${attachment.id}/review-status`, {
          headers,
          data: { issueId: issue.id, status: 'in_review' },
        })
        expect(review.status(), await review.text()).toBe(HTTP_OK)
      },
    )
    await page.reload()
    await expect(status(filename)).toHaveValue('in_review')
    await expect(status(urlLabel)).toHaveValue('in_review')
    const closed = await request.patch(`http://127.0.0.1:4392/api/issues/${issue.id}`, {
      headers,
      data: { status: terminal },
    })
    expect(closed.status(), await closed.text()).toBe(HTTP_OK)
    await page.reload()
    await expect(targets.getByText('表示するレビュー対象はありません。', { exact: true })).toBeVisible()
    await runInOrder(attachmentFixtures, async (attachment): Promise<void> => {
      const metadata = await request.get(`http://127.0.0.1:4392/api/files/${attachment.id}/metadata`, { headers })
      expect(metadata.status(), await metadata.text()).toBe(HTTP_OK)
      expect(await metadata.json()).toMatchObject({
        id: attachment.id,
        filename: attachment.filename,
        reviewStatus: terminal === 'done' && attachment.filename !== ordinaryLabel ? 'done' : null,
      })
      await expect(attachments.getByRole('link', { exact: true, name: attachment.filename })).toBeVisible()
      await expect(status(attachment.filename)).toHaveCount(0)
      if (terminal === 'cancelled' || attachment.filename === ordinaryLabel) {
        await expect(selected(attachment.filename)).not.toBeChecked()
      } else {
        await expect(selected(attachment.filename)).toHaveCount(0)
      }
    })
    await checkpoint(page, testInfo, `review-targets-owner-${terminal}-attachments-preserved`)
  })
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
  expect(createdWorkspace.status(), await createdWorkspace.text()).toBe(HTTP_CREATED)
  const headers = { 'X-Workspace-Slug': workspaceSlug }
  const session = await request.get('http://127.0.0.1:4392/auth/me')
  expect(session.status()).toBe(HTTP_OK)
  const { user } = await session.json()
  const projects: { id: string; key: string; name: string }[] = []
  await runInOrder(['A', 'B'], async (prefix): Promise<void> => {
    const created = await request.post('http://127.0.0.1:4392/api/projects', {
      headers,
      data: { name: `Cross project ${prefix} ${suffix}`, key: `${prefix}${suffix}` },
    })
    expect(created.status(), await created.text()).toBe(HTTP_CREATED)
    projects.push(await created.json())
  })
  const cases = [
    { assigned: true, project: 0, review: 'in_review', tag: 'Review assigned' },
    { assigned: false, project: 1, review: 'in_review', tag: 'Review unassigned' },
    { assigned: false, project: 0, review: 'fixing', tag: 'Fixing' },
    { assigned: true, project: 1, review: 'changes_requested', tag: 'Changes requested' },
    { assigned: false, project: 0, review: 'done', tag: 'Completed target' },
    { assigned: false, project: 1, review: null, tag: 'Ordinary newest' },
  ]
  const issues: {
    id: string
    number: number
    title: string
    targetLabel: string
    review: string | null
    project: (typeof projects)[number]
  }[] = []
  await runInOrder(cases, async (fixture): Promise<void> => {
    const project = projects[fixture.project]
    const title = `Cross review ${suffix} ${fixture.tag}`
    const created = await request.post('http://127.0.0.1:4392/api/issues', {
      headers,
      data: { projectId: project.id, title, status: 'backlog', ...(fixture.assigned ? { assigneeId: user.id } : {}) },
    })
    expect(created.status(), await created.text()).toBe(HTTP_CREATED)
    const issue = await created.json()
    const targetLabel = `${fixture.tag} target ${suffix}`
    if (Predicate.isNotNullish(fixture.review)) {
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
      expect(linked.status(), await linked.text()).toBe(HTTP_CREATED)
      const attachment = await linked.json()
      const selected = await request.patch(`http://127.0.0.1:4392/api/files/${attachment.id}/review-status`, {
        headers,
        data: { issueId: issue.id, status: fixture.review },
      })
      expect(selected.status(), await selected.text()).toBe(HTTP_OK)
    }
    issues.push({ id: issue.id, number: issue.number, title, targetLabel, review: fixture.review, project })
  })
  const visibleTitles = (): Locator =>
    page.getByRole('link', { name: new RegExp(`^Cross review ${suffix} `) }).filter({ visible: true })
  const assertReviewResults = async (review: string): Promise<void> => {
    const expected = issues.filter((issue) =>
      review === 'active' ? Predicate.isNotNullish(issue.review) && issue.review !== 'done' : issue.review === review,
    )
    await expect(visibleTitles()).toHaveCount(expected.length)
    await runInOrder(issues, async (issue): Promise<void> => {
      const link = page.getByRole('link', { exact: true, name: issue.title }).filter({ visible: true })
      if (expected.includes(issue)) {
        await expect(link).toBeVisible()
      } else {
        await expect(link).toHaveCount(0)
      }
    })
  }
  await page.goto(`/issues?workspace=${workspaceSlug}&projectId=${projects[0].id}`)
  await expect(page.getByText(`表示範囲: ${projects[0].key} · ${projects[0].name}`, { exact: true })).toBeVisible()
  await page.getByRole('link', { exact: true, name: '全プロジェクトのレビュー' }).click()
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
  await runInOrder(
    issues.filter((entry) => entry.review === 'in_review'),
    async (issue): Promise<void> => {
      await expect(
        page.getByText(`${issue.project.key}-${issue.number}`, { exact: true }).filter({ visible: true }),
      ).toBeVisible()
      const summary = page
        .getByRole('link', { exact: true, name: `Review targets: ${issue.targetLabel} (レビュー中)` })
        .filter({ visible: true })
      await summary.click()
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get('workspace') === workspaceSlug &&
          url.searchParams.get('tab') === 'review-targets' &&
          url.pathname.startsWith(`/projects/${issue.project.key}/issues/${issue.number}/`),
      )
      await expect(page.getByRole('heading', { exact: true, name: issue.title })).toBeVisible()
      await expect(page.getByText(issue.project.name, { exact: true }).filter({ visible: true })).toBeVisible()
      await page.goto(reviewUrl)
    },
  )
  await checkpoint(page, testInfo, 'cross-project-review-assigned-and-unassigned')

  const paged = new URL(reviewUrl)
  paged.searchParams.set('limit', '1')
  await page.goto(paged.href)
  await expect(visibleTitles()).toHaveCount(1)
  const firstTitle = await visibleTitles().innerText()
  const pagination = page.getByRole('navigation', { exact: true, name: 'Issue pagination' })
  await pagination.getByRole('button', { exact: true, name: 'Next page' }).click()
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.has('cursor') &&
      url.searchParams.get('review') === 'in_review' &&
      url.searchParams.get('limit') === '1',
  )
  await expect(visibleTitles()).toHaveCount(1)
  await expect(visibleTitles()).not.toHaveText(firstTitle)
  await expect(pagination.getByRole('link', { exact: true, name: 'First page' })).toBeVisible()
  await checkpoint(page, testInfo, 'cross-project-review-native-next-page')

  const tabs = page.getByRole('navigation', { exact: true, name: 'レビューステータスで課題を絞り込む' })
  await tabs.getByRole('link', { exact: true, name: '修正中' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('review') === 'fixing' && !url.searchParams.has('cursor'))
  await assertReviewResults('fixing')
  const fullPage = new URL(page.url())
  fullPage.searchParams.set('limit', '30')
  await page.goto(fullPage.href)
  await runInOrder(
    [
      ['in_review', 'レビュー中'],
      ['fixing', '修正中'],
      ['changes_requested', '要修正'],
      ['active', '未完了の対象'],
    ],
    async ([review, label]): Promise<void> => {
      await tabs.getByRole('link', { exact: true, name: label }).click()
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('review') === review && !url.searchParams.has('cursor'),
      )
      await expect(tabs.getByRole('link', { exact: true, name: label })).toHaveAttribute('aria-current', 'page')
      await assertReviewResults(review)
      await page.getByRole('searchbox', { exact: true, name: 'Search issues' }).fill(suffix)
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('q') === suffix && url.searchParams.get('review') === review,
      )
      await assertReviewResults(review)
      await page.reload()
      await assertReviewResults(review)
      await checkpoint(page, testInfo, `cross-project-review-search-${review}`)
    },
  )
  const coldContext = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: page.viewportSize() })
  try {
    const cold = await coldContext.newPage()
    observeBrowser(cold, testInfo)
    const coldPageResponse = await cold.goto(page.url())
    expect(coldPageResponse?.status()).toBe(HTTP_OK)
    await runInOrder(issues, async (issue): Promise<void> => {
      const link = cold.getByRole('link', { exact: true, name: issue.title }).filter({ visible: true })
      if (Predicate.isNotNullish(issue.review) && issue.review !== 'done') {
        await expect(link).toBeVisible()
      } else {
        await expect(link).toHaveCount(0)
      }
    })
    await cold
      .getByRole('navigation', { exact: true, name: 'レビューステータスで課題を絞り込む' })
      .getByRole('link', { exact: true, name: '要修正' })
      .click()
    await expect(cold).toHaveURL(
      (url) => url.searchParams.get('review') === 'changes_requested' && url.searchParams.get('q') === suffix,
    )
    await expect(
      cold
        .getByRole('link', { exact: true, name: `Cross review ${suffix} Changes requested` })
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
  expect(created.status(), await created.text()).toBe(HTTP_CREATED)
  const project = await created.json()
  const query = new URLSearchParams({ projectId: project.id, workspace: 'projektor' })
  const projectNavigationResponse = await page.goto(`/projects/view?${query}`)
  expect(projectNavigationResponse?.status()).toBe(HTTP_OK)
  await expect(page.getByText('No issues in this window yet', { exact: true })).toBeVisible()
  await expect(page.getByTestId('flow-chart-cfd')).toHaveCount(0)
  await checkpoint(page, testInfo, 'charts-empty-no-zero-band')

  // Public API transitions stamp the persisted timestamps read through Core by Web.
  // No DB edits, client props injection or chart implementation mocks.
  await runInOrder(
    ['backlog', 'in_progress', 'in_progress', 'in_review', 'done'].entries(),
    async ([index, status]): Promise<void> => {
      const issueResponse = await request.post('http://127.0.0.1:4392/api/issues', {
        headers,
        data: { projectId: project.id, title: `Chart issue ${index} ${suffix}` },
      })
      expect(issueResponse.status(), await issueResponse.text()).toBe(HTTP_CREATED)
      const issue = await issueResponse.json()
      if (status !== 'backlog') {
        const updated = await request.patch(`http://127.0.0.1:4392/api/issues/${issue.id}`, {
          headers,
          data: { status },
        })
        expect(updated.status(), await updated.text()).toBe(HTTP_OK)
      }
    },
  )
  const metricsResponse = await request.get(`http://127.0.0.1:4392/api/projects/${project.id}/flow-metrics`, {
    headers,
  })
  expect(metricsResponse.status(), await metricsResponse.text()).toBe(HTTP_OK)
  const metrics = await metricsResponse.json()
  expect(metrics.cfdOverTime.at(-1)).toMatchObject({ backlogTodo: 1, done: 1, inProgress: 2, inReview: 1 })
  await testInfo.attach('chart-api-data', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
  await page.reload()
  const chart = page.getByTestId('flow-chart-cfd')
  const areas = chart.locator('.recharts-area-area')
  await expect(areas).toHaveCount(4)
  await runInOrder(await areas.all(), async (area): Promise<void> => {
    await expect(area).toHaveAttribute('d', /[zZ]$/u)
    expect(await area.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0)
  })
  await runInOrder(['Backlog/todo', 'In progress', 'In review', 'Done'], async (label): Promise<void> => {
    await expect(chart.getByText(label, { exact: true })).toBeVisible()
  })
  await expect(page.getByTestId('flow-chart-throughput').locator('.recharts-bar-rectangle')).not.toHaveCount(0)
  await checkpoint(page, testInfo, 'charts-overview-filled-bands')
  const surface = chart.locator('svg.recharts-surface')
  const box = await surface.boundingBox()
  if (!box) {
    throw new Error('CFD chart has no rendered surface')
  }
  await page.mouse.move(box.x + box.width - 15, box.y + 80)
  const tooltip = chart.locator('.recharts-tooltip-wrapper')
  await expect(tooltip).toBeVisible()
  await expect(tooltip.getByText('In progress', { exact: true }).locator('../..')).toHaveText(/In progress\s*2$/u)
  await expect(tooltip.getByText('Backlog/todo', { exact: true }).locator('../..')).toHaveText(/Backlog\/todo\s*1$/u)
  await checkpoint(page, testInfo, 'charts-tooltip-raw-not-cumulative')
  await page.mouse.move(0, 0)
  const lightFill = await areas.last().evaluate((element) => getComputedStyle(element).fill)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => areas.last().evaluate((element) => getComputedStyle(element).fill)).not.toBe(lightFill)
  await checkpoint(page, testInfo, 'charts-system-dark-theme')
  await page.emulateMedia({ colorScheme: 'light' })
  const metricsPageResponse = await page.goto(`/metrics?${query}`)
  expect(metricsPageResponse?.status()).toBe(HTTP_OK)
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
        (_value, index) => `## Section ${index}\n\nScrollable persisted page content.`,
      ).join('\n\n'),
    },
  })
  expect(wikiResponse.status(), await wikiResponse.text()).toBe(HTTP_CREATED)
  const wikiPageResponse = await page.goto(`/wiki/view?${query}&slug=drawer-${suffix.toLowerCase()}`)
  expect(wikiPageResponse?.status()).toBe(HTTP_OK)
  if (testInfo.project.name === 'mobile') {
    const trigger = page.getByRole('button', { exact: true, name: 'Pages' })
    const drawer = page.locator('.wiki-sidebar.wiki-sidebar-open')
    const backdrop = page.locator('.wiki-drawer-overlay-open')
    await trigger.click()
    await expect(drawer).toBeVisible()
    const assertHeaderLayer = async (): Promise<void> => {
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
    viewport: testInfo.project.name === 'mobile' ? { height: 851, width: 393 } : { height: 1000, width: 1440 },
  })
  try {
    const page = await context.newPage()
    observeBrowser(page, testInfo)
    const response = await page.goto('/?workspace=projektor')
    expect(response?.status()).toBe(HTTP_OK)
    expect(response?.headers()['cache-control']).toMatch(/private/u)
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { exact: true, name: 'Projects' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Account(?::|$)/u })).toBeVisible()
    if (testInfo.project.name === 'mobile') {
      const menu = page.getByRole('button', { exact: true, name: 'Toggle Sidebar' })
      await expect(menu).toBeVisible()
      await expect(menu).toBeDisabled()
    }
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
  await page.getByRole('textbox', { exact: true, name: 'Name' }).fill(projectName)
  await page.getByRole('textbox', { exact: true, name: 'Key' }).fill(projectKey)
  await checkpoint(page, testInfo, 'native-project-form')
  await page.getByRole('button', { exact: true, name: 'Create project' }).click()
  const projectLink = page.getByRole('link').filter({ hasText: projectName })
  await expect(projectLink).toHaveCount(1)
  await checkpoint(page, testInfo, 'project-created-canonical-list')
  await projectLink.click()
  await expect(page.getByRole('heading', { exact: true, level: 1, name: projectName })).toBeVisible()
  await checkpoint(page, testInfo, 'project-created-detail')
  await expect(page).toHaveURL((url) => url.pathname.startsWith('/projects/view/'))
  const projectUrl = page.url()
  const sections = page.getByRole('navigation', { name: 'Project sections' })
  await sections.getByRole('link', { exact: true, name: 'Issues' }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/issues')
  const issuesUrl = page.url()
  expect(new URL(issuesUrl).searchParams.get('workspace')).toBe('projektor')
  expect(new URL(issuesUrl).searchParams.get('projectId')).toBeTruthy()
  await checkpoint(page, testInfo, 'project-scoped-issues')
  await page.getByRole('button', { name: /New issue/u }).click()
  const dialog = page.getByRole('dialog', { name: 'Create new issue' })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('Issue title').fill(issueTitle)
  await checkpoint(page, testInfo, 'native-issue-form')
  await dialog.getByRole('button', { exact: true, name: 'Create issue' }).click()
  await expect(dialog).not.toBeVisible()
  const issueLink = page.getByRole('link', { exact: true, name: issueTitle })
  await expect(issueLink).toBeVisible()
  await checkpoint(page, testInfo, 'issue-created-canonical-list')
  const canonicalIssueUrl = new URL((await issueLink.getAttribute('href')) ?? '', page.url()).href
  await issueLink.click()
  await expect(page.getByRole('heading', { exact: true, name: issueTitle })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-created-detail')
  await expect(page).toHaveURL(canonicalIssueUrl)
  const issueUrl = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { exact: true, name: issueTitle })).toBeVisible()
  await checkpoint(page, testInfo, 'issue')
  const issueBody = `Native Core-backed update ${suffix}`
  await page.getByTitle('Edit description', { exact: true }).click()
  await page.getByRole('textbox', { exact: true, name: 'Markdown editor' }).fill(issueBody)
  await page.getByRole('button', { exact: true, name: 'Save' }).click()
  await expect(page.getByText(issueBody, { exact: true })).toBeVisible()
  await expect(page.locator('.markdown-content').getByText(issueBody, { exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-updated-canonical-body')
  await page.reload()
  await expect(page.getByText(issueBody, { exact: true })).toBeVisible()
  await expect(page.locator('.markdown-content').getByText(issueBody, { exact: true })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-updated-body-reload')
  const filename = `native-attachment-${suffix}.txt`
  const bytes = Buffer.alloc(65_536, 'native-effront-attachment\n')
  await page.getByRole('button', { name: /Attach file/u }).click()
  await page.getByLabel('Choose file', { exact: true }).setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: bytes,
  })
  await checkpoint(page, testInfo, 'native-attachment-form')
  await page.getByRole('button', { exact: true, name: 'Upload' }).click()
  const attachment = page.locator('a[href^="/api/files/"]').filter({ hasText: filename })
  await expect(attachment).toBeVisible()
  const filePath = new URL((await attachment.getAttribute('href')) ?? '', page.url()).pathname
  const apiFile = await request.get(`http://127.0.0.1:4392${filePath}`, {
    headers: { 'X-Workspace-Slug': 'projektor' },
  })
  expect(apiFile.status()).toBe(HTTP_OK)
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
  if (!stream) {
    throw new Error('The native attachment download returned no stream.')
  }
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }
  expect(Buffer.concat(chunks)).toEqual(bytes)
  await checkpoint(page, testInfo, 'native-attachment-download')
  await page.getByRole('button', { exact: true, name: `Remove ${filename}` }).click()
  await expect(attachment).toHaveCount(0)
  await page.reload()
  await expect(attachment).toHaveCount(0)
  const removedFile = await request.get(`http://127.0.0.1:4392${filePath}`, {
    headers: { 'X-Workspace-Slug': 'projektor' },
  })
  expect(removedFile.status()).toBe(HTTP_NOT_FOUND)
  await checkpoint(page, testInfo, 'native-attachment-deleted-reload')
  await page.goBack()
  await expect(page).toHaveURL(issuesUrl)
  await expect(page.getByRole('link', { exact: true, name: issueTitle })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-back-scoped-list')
  await page.goForward()
  await expect(page).toHaveURL(issueUrl)
  await expect(page.getByRole('heading', { exact: true, name: issueTitle })).toBeVisible()
  await checkpoint(page, testInfo, 'issue-forward-detail')
  await assertShell(page)
  await page.goto(projectUrl)
  await checkpoint(page, testInfo, 'project')
  await page
    .getByRole('navigation', { name: 'Project sections' })
    .getByRole('link', { exact: true, name: 'Wiki' })
    .click()
  await expect(page).toHaveURL((url) => url.pathname === '/wiki')
  const wikiScope = new URL(page.url())
  expect(wikiScope.searchParams.get('workspace')).toBe('projektor')
  expect(wikiScope.searchParams.get('projectId')).toBe(new URL(projectUrl).searchParams.get('projectId'))
  await checkpoint(page, testInfo, 'project-scoped-wiki')
  const pages = page.getByRole('button', { exact: true, name: 'Pages' })
  if (await pages.isVisible()) {
    await pages.click()
  }
  await page.getByRole('button', { exact: true, name: '+ New page' }).click()
  const wikiTitle = `Native wiki ${suffix}`
  await page.getByPlaceholder('Page title', { exact: true }).fill(wikiTitle)
  const editor = page.getByRole('textbox', { exact: true, name: 'Markdown editor' })
  await expect(editor).toBeVisible()
  await editor.fill(
    `## Comark acceptance ${suffix}\n\nA **strong** native paragraph.\n\n- One\n- Two\n\n| Surface | Status |\n| --- | --- |\n| Web | Ready |\n\n\`\`\`ts\nconst ready = true\n\`\`\`\n\n[Scoped project](${projectUrl})\n\n<script>window.__acceptanceInjected = true</script>`,
  )
  await checkpoint(page, testInfo, 'native-wiki-form')
  await page.getByRole('button', { exact: true, name: 'Create page' }).click()
  await expect(page.getByRole('heading', { exact: true, level: 1, name: wikiTitle })).toBeVisible()
  await expect(page.getByRole('heading', { exact: true, level: 2, name: `Comark acceptance ${suffix}` })).toBeVisible()
  await expect(page.locator('.markdown-content table')).toBeVisible()
  await expect(page.locator('.markdown-content pre.shiki')).toBeVisible()
  await expect(page.locator('strong').filter({ hasText: /^strong$/u })).toBeVisible()
  await expect(page.getByRole('link', { exact: true, name: 'Scoped project' })).toHaveAttribute('href', projectUrl)
  expect(await page.evaluate(() => '__acceptanceInjected' in window)).toBe(false)
  await checkpoint(page, testInfo, 'wiki-created-comark-render')
  await expect(page).toHaveURL((url) => url.pathname.startsWith('/wiki/'))
  const wikiUrl = page.url()
  expect(new URL(wikiUrl).searchParams.get('workspace')).toBe('projektor')
  expect(new URL(wikiUrl).searchParams.get('projectId')).toBe(new URL(projectUrl).searchParams.get('projectId'))
  await page.reload()
  await expect(page.getByRole('heading', { exact: true, level: 1, name: wikiTitle })).toBeVisible()
  await expect(page.getByRole('heading', { exact: true, level: 2, name: `Comark acceptance ${suffix}` })).toBeVisible()
  expect(await page.evaluate(() => '__acceptanceInjected' in window)).toBe(false)
  await checkpoint(page, testInfo, 'wiki-reload-comark-render')
  const timeOrigin = await page.evaluate(() => performance.timeOrigin)
  const refreshPost = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/auth/session' && response.request().method() === 'POST',
  )
  const refreshedDocument = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
  })
  await page.getByRole('button', { name: /^Account(?::|$)/u }).click()
  await page.getByRole('menuitem', { exact: true, name: 'Refresh session' }).click()
  const refreshedResponse = await refreshPost
  expect(refreshedResponse.status()).toBe(303)
  await refreshedDocument
  await expect(page).toHaveURL(wikiUrl)
  await expect(page.getByRole('heading', { exact: true, level: 1, name: wikiTitle })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(timeOrigin)
  await checkpoint(page, testInfo, 'native-session-document-refresh')
  /*
   * A fresh document with JS disabled proves the mutation reached real D1,
   * rather than being held in hydrated component state.
   */
  const noJs = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: page.viewportSize(),
  })
  try {
    const cold = await noJs.newPage()
    observeBrowser(cold, testInfo)
    const issueNavigationResponse = await cold.goto(issueUrl)
    expect(issueNavigationResponse?.status()).toBe(HTTP_OK)
    await expect(cold.getByRole('heading', { exact: true, name: issueTitle })).toBeVisible()
    await checkpoint(cold, testInfo, 'cold-persisted-issue-no-js')
  } finally {
    await noJs.close()
  }
  expect(errors).toEqual([])
})

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
    { body: project.name, heading: 'Projects', id: 'projects', path: '/?workspace=projektor' },
    {
      body: issue.title,
      heading: project.name,
      id: 'overview-query',
      path: `/projects/view?${scope}`,
    },
    {
      body: issue.title,
      heading: project.name,
      id: 'overview-path',
      path: `/projects/view/${project.slug}?workspace=projektor`,
    },
    { heading: 'Getting started', id: 'help', path: '/help' },
    { body: issue.title, heading: 'Issues', id: 'issues', path: `/issues?${scope}` },
    {
      body: 'Persisted reader body.',
      heading: issue.title,
      id: 'issue-query',
      path: `/issues/view?id=${issue.id}&${scope}`,
    },
    {
      body: 'Persisted reader body.',
      heading: issue.title,
      id: 'issue-path',
      path: `/projects/${project.key}/issues/${issue.number}/reader-issue?workspace=projektor`,
    },
    {
      body: issue.title,
      heading: 'My Issues',
      id: 'my-issues',
      path: '/my-issues?workspace=projektor',
    },
    { body: epic.title, heading: 'Epics', id: 'epics', path: `/epics?${scope}` },
    { body: sprints[0].name, heading: 'Sprints', id: 'sprints', path: `/sprints?${scope}` },
    { heading: 'Metrics', id: 'metrics', path: `/metrics?${scope}` },
    {
      id: 'wiki-index',
      path: `/wiki?${scope}`,
      text: 'Select a page from the sidebar or create a new one.',
    },
    {
      body: 'Persisted Wiki reader body.',
      heading: wiki.title,
      id: 'wiki-query',
      path: `/wiki/view?slug=${wiki.slug}&${scope}`,
    },
    {
      body: 'Persisted Wiki reader body.',
      heading: wiki.title,
      id: 'wiki-path',
      path: `/wiki/${wiki.slug}?${scope}`,
    },
    {
      body: sourceName,
      heading: 'Feedback sources',
      id: 'feedback-grid',
      path: `/feedback?${scope}`,
    },
    {
      body: feedbackBody,
      heading: sourceName,
      id: 'feedback-query',
      path: `/feedback/view?sourceId=${sourceId}&${scope}`,
    },
    {
      body: feedbackBody,
      heading: sourceName,
      id: 'feedback-path',
      path: `/feedback/${sourceId}?${scope}`,
    },
    {
      body: group.name,
      id: 'groups',
      path: '/settings/groups?workspace=projektor',
      text: 'You manage which groups can access which projects.',
    },
    { heading: 'Connect Claude Code', id: 'tokens', path: '/settings/tokens?workspace=projektor' },
    {
      body: 'Persisted reader body.',
      heading: issue.title,
      id: 'share-query',
      path: `/share/view?token=${shareToken}`,
    },
    {
      body: 'Persisted reader body.',
      heading: issue.title,
      id: 'share-path',
      path: `/share/${shareToken}`,
    },
  ]
  expect(cases).toHaveLength(21)
  await runInOrder([false, true], async (javaScriptEnabled): Promise<void> => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled,
      viewport: page.viewportSize(),
    })
    try {
      const reader = await context.newPage()
      observeBrowser(reader, testInfo)
      await runInOrder(cases, async (route): Promise<void> => {
        const response = await reader.goto(route.path)
        expect(response?.status(), route.id).toBe(HTTP_OK)
        if (isNonEmptyText(route.heading)) {
          await expect(reader.getByRole('heading', { exact: true, level: 1, name: route.heading })).toBeVisible()
        }
        if (isNonEmptyText(route.text)) {
          await expect(reader.getByText(route.text, { exact: true })).toBeVisible()
        }
        if (isNonEmptyText(route.body)) {
          await expect(reader.locator('body')).toContainText(route.body)
        }
        await checkpoint(reader, testInfo, `${javaScriptEnabled ? 'js-on' : 'js-off'}-${route.id}`)
      })
    } finally {
      await context.close()
    }
  })
})

test('large dataset tabs use scoped native URLs and survive reload and history', async ({
  request,
  page,
}, testInfo) => {
  const { project, sourceId, sprints, group, user, feedbackBody } = await createReaderFixtures(request)
  const scope = new URLSearchParams({ workspace: 'projektor', projectId: project.id }).toString()
  await page.goto(`/sprints?${scope}`)
  await runInOrder(
    [
      ['Planned', 'planned'],
      ['Active', 'active'],
      ['History', 'completed'],
      ['All', 'all'],
    ],
    async ([name, value]): Promise<void> => {
      await page.getByRole('link', { exact: true, name }).click()
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get('status') === value &&
          url.searchParams.get('projectId') === project.id &&
          url.searchParams.get('workspace') === 'projektor',
      )
      await expect(page.getByRole('link', { exact: true, name })).toHaveAttribute('aria-current', 'page')
      await runInOrder(
        sprints.filter((sprint) => value === 'all' || sprint.status === value),
        async (sprint): Promise<void> => {
          await expect(page.locator('body')).toContainText(sprint.name)
        },
      )
      await checkpoint(page, testInfo, `sprint-tab-${value}`)
    },
  )
  await page.goto('/settings/groups?workspace=projektor')
  await page.getByRole('tab', { exact: true, name: 'Members' }).click()
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('view') === 'members' && url.searchParams.get('workspace') === 'projektor',
  )
  await expect(page.getByRole('tab', { exact: true, name: 'Members' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toContainText(user.email)
  await checkpoint(page, testInfo, 'groups-members-tab')
  await page.reload()
  await expect(page.getByRole('tab', { exact: true, name: 'Members' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { exact: true, name: 'Groups' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'groups')
  await expect(page.getByRole('tabpanel')).toContainText(group.name)
  await checkpoint(page, testInfo, 'groups-groups-tab')
  await page.goto(`/feedback/${sourceId}?${scope}`)
  await runInOrder(
    [
      ['Summary', 'summary'],
      ['Settings', 'settings'],
      ['Items', 'items'],
    ],
    async ([name, value]): Promise<void> => {
      await page.getByRole('tab', { exact: true, name }).click()
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('tab') === value && url.searchParams.get('workspace') === 'projektor',
      )
      await expect(page.getByRole('tab', { exact: true, name })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('tabpanel')).toContainText(
        value === 'items' ? feedbackBody : value === 'summary' ? 'acceptance-v1' : 'Created',
      )
      await checkpoint(page, testInfo, `feedback-tab-${value}`)
    },
  )
  await page.goBack()
  await expect(page.getByRole('tab', { exact: true, name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  await checkpoint(page, testInfo, 'feedback-history-settings')
  await page.goForward()
  await expect(page.getByRole('tab', { exact: true, name: 'Items' })).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await expect(page.getByRole('tab', { exact: true, name: 'Items' })).toHaveAttribute('aria-selected', 'true')
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
  expect(createdWorkspace.status(), await createdWorkspace.text()).toBe(HTTP_CREATED)
  const key = `C${suffix.toUpperCase()}`
  const projects: { id: string; name: string }[] = []
  await runInOrder(['projektor', slug], async (workspace): Promise<void> => {
    const created = await request.post('http://127.0.0.1:4392/api/projects', {
      headers: { 'X-Workspace-Slug': workspace },
      data: { name: `Collision ${workspace}`, key },
    })
    expect(created.status(), await created.text()).toBe(HTTP_CREATED)
    projects.push(await created.json())
  })
  await page.goto(`/issues?project=${key}`)
  await expect(page.getByRole('heading', { exact: true, name: 'Select a project' })).toBeVisible()
  await checkpoint(page, testInfo, 'ambiguous-project-key-no-default-tenant')
  await page.getByLabel('Project', { exact: true }).selectOption(projects[1].id)
  await page.getByRole('button', { exact: true, name: 'Continue' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('projectId') === projects[1].id)
  await expect(page.getByRole('heading', { exact: true, name: 'Issues' })).toBeVisible()
  await checkpoint(page, testInfo, 'native-collision-project-selection')
  await page.goto('/')
  await page.getByText('+ New project', { exact: true }).click()
  await expect(page.getByRole('combobox', { exact: true, name: 'Workspace' })).toHaveValue('')
  const projectName = `Second native ${suffix}`
  await page.getByRole('textbox', { exact: true, name: 'Name' }).fill(projectName)
  await page.getByRole('textbox', { exact: true, name: 'Key' }).fill(`N${suffix.toUpperCase()}`)
  await expect(page.getByRole('button', { exact: true, name: 'Create project' })).toBeDisabled()
  await page.getByRole('combobox', { exact: true, name: 'Workspace' }).selectOption(slug)
  await checkpoint(page, testInfo, 'explicit-second-workspace-native-form')
  await page.getByRole('button', { exact: true, name: 'Create project' }).click()
  const link = page.getByRole('link').filter({ has: page.getByText(projectName, { exact: true }) })
  await expect(link).toHaveCount(1)
  expect(new URL((await link.getAttribute('href')) ?? '', page.url()).searchParams.get('workspace')).toBe(slug)
  await link.click()
  await expect(page.getByRole('heading', { exact: true, level: 1, name: projectName })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { exact: true, level: 1, name: projectName })).toBeVisible()
  await checkpoint(page, testInfo, 'second-workspace-native-create-reload')
  await page
    .getByRole('navigation', { name: 'Project sections' })
    .getByRole('link', { exact: true, name: 'Issues' })
    .click()
  await expect(page).toHaveURL((url) => url.pathname === '/issues' && url.searchParams.get('workspace') === slug)
  await checkpoint(page, testInfo, 'second-workspace-native-issues-link')
  await page.goBack()
  await expect(page.getByRole('heading', { exact: true, level: 1, name: projectName })).toBeVisible()
  await checkpoint(page, testInfo, 'second-workspace-history-overview')
  const mismatch = await request.get(`/issues?workspace=projektor&projectId=${projects[1].id}`)
  expect([HTTP_FORBIDDEN, HTTP_NOT_FOUND]).toContain(mismatch.status())
  expect(await mismatch.text()).not.toContain(projects[1].name)
})
