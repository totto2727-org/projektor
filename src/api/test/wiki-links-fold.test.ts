import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { env } from './fixture-api.ts'
import { authHeaders, seedFixture, seedProject, seedWorkspaceRoles } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { resetRateLimits } from './rate-limit-reset.ts'
/*
 * PROJ-818: link titles fold case the same way on both sides (in JS, stored), so
 * accented Latin titles resolve; and link reads never reveal pages in projects the
 * caller can't see.
 */
import { IdAndSlugResponse, readNativeJson } from './response-json.ts'

const call = async function call(url: string, token: string, slug: string, init?: RequestInit): Promise<Response> {
  await resetRateLimits()
  return fetchNativeApi(url, { ...init, headers: authHeaders(token, slug) })
}

const createPage = async function createPage(
  token: string,
  slug: string,
  body: { title: string; content?: string; projectId?: string },
): Promise<{ id: string; slug: string }> {
  const res = await call('http://localhost/api/wiki', token, slug, {
    method: 'POST',
    body: JSON.stringify({ content: '', ...body }),
  })
  expect(res.status).toBe(201)
  return readNativeJson(res, IdAndSlugResponse)
}

const broken = async function broken(
  token: string,
  slug: string,
): Promise<{ sourceSlug: string; targetTitle: string }[]> {
  const res = await call('http://localhost/api/wiki/broken-links', token, slug)
  expect(res.status).toBe(200)
  return readNativeJson(
    res,
    Schema.Array(Schema.Struct({ sourceSlug: Schema.String, targetTitle: Schema.String })).pipe(Schema.mutable),
  )
}

const targetOf = async function targetOf(sourceId: string): Promise<null | string> {
  const row = await env.DB.prepare('SELECT target_page_id AS t FROM wiki_links WHERE source_page_id = ?')
    .bind(sourceId)
    .first<{ t: string | null }>()
  return row?.t ?? null
}

describe('covers PROJ-818: accented Latin titles fold on both sides', () => {
  test("[[über uns]] resolves to a page titled 'Über uns'", async () => {
    const { token, workspace } = await seedFixture({ role: 'owner' })
    const target = await createPage(token, workspace.slug, { title: 'Über uns' })
    const source = await createPage(token, workspace.slug, {
      title: 'Home',
      content: 'See [[über uns]].',
    })
    await expect(targetOf(source.id)).resolves.toBe(target.id)
  })

  test("a link written before the page exists resolves when 'Über uns' is created", async () => {
    const { token, workspace } = await seedFixture({ role: 'owner' })
    const source = await createPage(token, workspace.slug, {
      title: 'Home',
      content: 'See [[ÜBER UNS]].',
    })
    await expect(targetOf(source.id)).resolves.toBeNull()
    const target = await createPage(token, workspace.slug, { title: 'über uns' })
    await expect(targetOf(source.id)).resolves.toBe(target.id)
  })

  test('pre-migration rows with a NULL fold are healed before matching', async () => {
    const { token, workspace, user } = await seedFixture({ role: 'owner' })
    const legacyId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO wiki_pages (id, workspace_id, slug, title, content, created_by_id, updated_by_id, created_at, updated_at)
			 VALUES (?, ?, 'legacy-uber', 'Über Legacy', '', ?, ?, 0, 0)`,
    )
      .bind(legacyId, workspace.id, user.id, user.id)
      .run()
    const source = await createPage(token, workspace.slug, {
      title: 'Links',
      content: '[[über legacy]]',
    })
    await expect(targetOf(source.id)).resolves.toBe(legacyId)
  })
})

describe("covers PROJ-818: link reads don't reveal pages in hidden projects", () => {
  test('a link to a page in a hidden project is reported broken, as written', async () => {
    const { workspace, owner, member } = await seedWorkspaceRoles()
    const hidden = await seedProject(workspace.id, 'HID')
    await createPage(owner.token, workspace.slug, { title: 'Secret Plan', projectId: hidden.id })
    const secretBySlug = await createPage(owner.token, workspace.slug, {
      title: 'Other Secret Title',
      projectId: hidden.id,
    })
    // Workspace-level page (visible to everyone) linking into the hidden project.
    await createPage(owner.token, workspace.slug, {
      title: 'Public Index',
      content: `[[Secret Plan]] and [x](/wiki/${secretBySlug.slug})`,
    })

    const asMember = await broken(member.token, workspace.slug)
    const fromIndex = asMember.filter((backlink) => backlink.sourceSlug === 'public-index').map((b) => b.targetTitle)
    expect(fromIndex.toSorted()).toStrictEqual(['Secret Plan', secretBySlug.slug].toSorted())
    expect(fromIndex).not.toContain('Other Secret Title')

    // The owner can see the project: nothing broken.
    const asOwner = await broken(owner.token, workspace.slug)
    expect(asOwner.filter((backlink) => backlink.sourceSlug === 'public-index')).toStrictEqual([])
  })
})

describe("covers PROJ-818: legacy link rows don't leak a hidden page's title", () => {
  test('a pre-0063 resolved row (no target_text) into a hidden project shows no title', async () => {
    const { workspace, owner, member } = await seedWorkspaceRoles()
    const hidden = await seedProject(workspace.id, 'HID')
    const secret = await createPage(owner.token, workspace.slug, {
      title: 'Hidden Title',
      projectId: hidden.id,
    })
    const src = await createPage(owner.token, workspace.slug, { title: 'Legacy Src' })
    // As a pre-0063 slug link resolved to the hidden page would look.
    await env.DB.prepare(
      `INSERT INTO wiki_links (id, workspace_id, source_page_id, target_page_id, target_title, created_at)
			 VALUES (?, ?, ?, ?, 'Hidden Title', 0)`,
    )
      .bind(crypto.randomUUID(), workspace.id, src.id, secret.id)
      .run()
    const rowsResult = await broken(member.token, workspace.slug)
    const rows = rowsResult.filter((backlink) => backlink.sourceSlug === src.slug)
    expect(rows).toHaveLength(1)
    expect(rows[0].targetTitle).not.toContain('Hidden')
  })
})
