import { Effect } from 'effect'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createTestDatabase } from '../../test/database'
import { DEFAULT_BRAND, layerBrand } from './brand'
import { renderShare as renderShareEffect } from './server'

const renderShare = (...args: Parameters<typeof renderShareEffect>) => Effect.runPromise(renderShareEffect(...args))
const workspaceBrand = {
  displayName: 'Acme',
  accent: '#123456',
  onAccent: '#ffffff',
  fontFamily: 'serif',
  fontUrl: 'https://example.com/fonts.css',
  logoUrl: null,
}
const body = '## Details\n\nComplete **SSR body**.\n\n<script>evil()</script>\n\n```mermaid\ngraph TD; A-->B\n```'
const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
async function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  database.sqlite.exec(`
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace','Acme','acme',1);
    INSERT INTO users (id,email,name,created_at) VALUES ('user','alice@example.test','Alice',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace','user','owner',1);
    INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('project','workspace','Demo','DEMO','demo',1,1);
    INSERT INTO task_statuses (id,workspace_id,key,name,category) VALUES ('status','workspace','started','In progress','in_progress');
    INSERT INTO issues (id,workspace_id,project_id,number,title,body,status_id,priority,assignee_id,created_by_id,created_at,updated_at) VALUES ('issue','workspace','project',1,'Public issue','','status','high','user','user',1700000000,1);
    INSERT INTO custom_field_definitions (id,workspace_id,key,label,type,created_at,is_internal) VALUES ('env','workspace','env','Environment','text',1,0),('secret','workspace','secret','Internal secret','text',1,1);
    INSERT INTO custom_field_values (issue_id,field_id,value) VALUES ('issue','env','Production'),('issue','secret','Private value');
  `)
  database.sqlite.prepare("UPDATE issues SET body = ? WHERE id = 'issue'").run(body)
  database.sqlite.prepare("UPDATE workspaces SET brand = ? WHERE id = 'workspace'").run(JSON.stringify(workspaceBrand))
  const token = 'public-token'
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  database.sqlite
    .prepare(
      'INSERT INTO share_tokens (id,issue_id,workspace_id,created_by,expires_at,created_at) VALUES (?,?,?,?,?,?)',
    )
    .run(hash, 'issue', 'workspace', 'user', Math.floor(Date.now() / 1000) + 86400, 1)
  return { ...database, token, env: { DB: database.db } }
}
describe('public Share SSR', () => {
  it('reads the public token without browser credentials and renders the exact sanitized DTO and workspace branding', async () => {
    const test = await fixture()
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Public share must not use HTTP'))
    const html = renderToStaticMarkup(
      await renderShare(test.env, null, new URL('https://app.test/share/view?token=public-token')),
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(html).toContain('Complete <strong>SSR body</strong>.')
    expect(html).toContain('Environment')
    expect(html).toContain('Production')
    expect(html).toContain('Shared Issue - Acme')
    expect(html).toContain('--accent:#123456')
    expect(html).toContain('fonts.css')
    expect(html).toContain('class="mermaid"')
    expect(html).not.toContain('evil()')
    expect(html).not.toContain('Private value')
    expect(html).not.toContain('Internal secret')
  })
  it('does not bootstrap a missing token and renders expired/not-found links', async () => {
    const test = await fixture()
    const prepare = vi.spyOn(test.db, 'prepare')
    const missing = renderToStaticMarkup(await renderShare(test.env, null, new URL('https://app.test/share/view')))
    expect(prepare).not.toHaveBeenCalled()
    expect(missing).toContain('Link not found or expired')
    test.sqlite.exec('UPDATE share_tokens SET expires_at = 1')
    const expired = renderToStaticMarkup(
      await renderShare(test.env, null, new URL('https://app.test/share/token'), { token: test.token }),
    )
    expect(expired).toContain('Link not found or expired')
    const unknown = renderToStaticMarkup(
      await renderShare(test.env, null, new URL('https://app.test/share/unknown'), { token: 'unknown' }),
    )
    expect(unknown).toContain('Link not found or expired')
  })
  it.each(['archive', 'membership', 'grant', 'issue', 'token'] as const)(
    'rechecks live token visibility after %s removal',
    async (change) => {
      const test = await fixture()
      if (change === 'archive') test.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id = 'project'")
      if (change === 'membership') test.sqlite.exec('DELETE FROM workspace_members')
      if (change === 'grant') test.sqlite.exec("UPDATE workspace_members SET role = 'member'")
      if (change === 'issue') test.sqlite.exec('DELETE FROM issues')
      if (change === 'token') test.sqlite.exec('DELETE FROM share_tokens')
      const html = renderToStaticMarkup(
        await renderShare(test.env, null, new URL('https://app.test/share/view?token=ignored'), { token: test.token }),
      )
      expect(html).toContain('Link not found or expired')
      expect(html).not.toContain('Public issue')
    },
  )
  it('preserves typed database failures for the root error boundary without leaking diagnostics', async () => {
    const test = await fixture()
    vi.spyOn(test.db, 'prepare').mockImplementationOnce(() => {
      throw new Error('Sensitive driver details')
    })
    await expect(
      renderShare(test.env, null, new URL('https://app.test/share/token?token=ignored'), { token: test.token }),
    ).rejects.toMatchObject({ kind: 'request', status: 500, message: 'The operation could not be completed.' })
  })
  it('layers null workspace fields over native deployment defaults', async () => {
    expect(layerBrand(DEFAULT_BRAND, { ...workspaceBrand, displayName: null, accent: null, logoUrl: null }).name).toBe(
      'Projektor',
    )
    const test = await fixture()
    test.sqlite.prepare("UPDATE workspaces SET brand = ? WHERE id = 'workspace'").run('{}')
    const html = renderToStaticMarkup(
      await renderShare(
        { ...test.env, BRAND_NAME: 'Custom Deployment', BRAND_ACCENT: '#abcdef' },
        null,
        new URL('https://app.test/share/token'),
        { token: test.token },
      ),
    )
    expect(html).toContain('Shared Issue - Custom Deployment')
    expect(html).toContain('--accent:#abcdef')
  })
  it('keeps token-scoped public logo URLs in the shared DTO rather than private workspace branding paths', async () => {
    const test = await fixture()
    test.sqlite
      .prepare("UPDATE workspaces SET brand = ? WHERE id = 'workspace'")
      .run(JSON.stringify({ ...workspaceBrand, logoR2Key: 'workspace/workspace/brand/logo.svg' }))
    const html = renderToStaticMarkup(
      await renderShare(test.env, null, new URL('https://app.test/share/token'), { token: test.token }),
    )
    expect(html).toContain(`/api/share/${test.token}/logo`)
    expect(html).not.toContain('/api/workspaces/acme/brand/logo')
  })
  it('rejects malformed public DTOs with operation-owned decoding', async () => {
    const test = await fixture()
    test.sqlite.exec("UPDATE issues SET created_at = 'not-a-number' WHERE id = 'issue'")
    await expect(
      renderShare(test.env, null, new URL('https://app.test/share/token'), { token: test.token }),
    ).rejects.toMatchObject({ kind: 'schema', status: 502 })
  })
})
