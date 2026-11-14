import { createExecutionContext, SELF, waitOnExecutionContext } from 'cloudflare:test'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { HonoEnv } from '#types'

import { authMiddleware } from '../middleware/auth'
import { subdomainRoutingEnabled, workspaceMiddleware } from '../middleware/workspace'
import { env } from './fixture-api'
import { seedFixture } from './helpers'

describe('subdomainRoutingEnabled', () => {
  it.each(['true', '1', 'yes', 'TRUE', 'Yes', ' true ', '1 '])('accepts %j', (v) => {
    expect(subdomainRoutingEnabled(v)).toBe(true)
  })

  it.each([undefined, '', 'false', '0', 'no', 'on'])('rejects %j', (v) => {
    expect(subdomainRoutingEnabled(v)).toBe(false)
  })
})

// PROJ-267 (epic PROJ-261, C2): Host-header subdomain routing is opt-in via
// WORKSPACE_SUBDOMAIN_ROUTING and off by default.
describe('workspace subdomain routing (WORKSPACE_SUBDOMAIN_ROUTING)', () => {
  beforeEach(() => {
    env.WORKSPACE_SUBDOMAIN_ROUTING = undefined
  })

  it('X-Workspace-Slug header works regardless of the flag', async () => {
    const fixture = await seedFixture()
    const res = await SELF.fetch(`http://localhost/mcp/${fixture.workspace.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fixture.token}`,
        'X-Workspace-Slug': fixture.workspace.slug,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(200)
  })

  // Uses a REST route: PROJ-348 gives the /mcp/<id> route a path-UUID fallback, so
  // the "no header → 400" contract now only holds for non-MCP routes.
  it('flag off + no header: clean 400 naming the missing header, Host subdomain is ignored', async () => {
    const fixture = await seedFixture()
    const res = await SELF.fetch('http://localhost/api/task-types', {
      headers: {
        Authorization: `Bearer ${fixture.token}`,
        Host: `${fixture.workspace.slug}.example.com`,
      },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('X-Workspace-Slug')
  })

  it('flag on + no header + matching Host subdomain resolves the workspace', async () => {
    const fixture = await seedFixture()
    env.WORKSPACE_SUBDOMAIN_ROUTING = 'true'
    const res = await SELF.fetch(`http://localhost/mcp/${fixture.workspace.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fixture.token}`,
        Host: `${fixture.workspace.slug}.example.com`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(200)
  })

  it('flag "1" (truthy, non-"true") + no header + matching Host subdomain resolves', async () => {
    const fixture = await seedFixture()
    env.WORKSPACE_SUBDOMAIN_ROUTING = '1'
    const res = await SELF.fetch(`http://localhost/mcp/${fixture.workspace.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fixture.token}`,
        Host: `${fixture.workspace.slug}.example.com`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(200)
  })

  // PROJ-494: the `?workspace=` query-param fallback is opt-in per route (only GET
  // /api/files*, see index.ts) — everything else must keep requiring the header.
  it("a ?workspace= query param is ignored on routes that didn't opt in", async () => {
    const fixture = await seedFixture()
    const res = await SELF.fetch(`http://localhost/api/task-types?workspace=${fixture.workspace.slug}`, {
      headers: { Authorization: `Bearer ${fixture.token}` },
    })
    expect(res.status).toBe(400)
  })

  it('flag off + no header + a resolvable subdomain warns before the 400', async () => {
    const fixture = await seedFixture()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const headers = {
        Authorization: `Bearer ${fixture.token}`,
        Host: `${fixture.workspace.slug}.example.com`,
      }
      const res = await SELF.fetch('http://localhost/api/task-types', { headers })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'Workspace not specified: missing X-Workspace-Slug header' })

      // Observe the routing adapter's diagnostic locally while resolution still
      // executes against the native Core binding, not a primary DB fixture spy.
      const app = new Hono<HonoEnv>()
      app.use('*', authMiddleware, workspaceMiddleware)
      app.get('/api/task-types', (c) => c.json({ unexpected: true }))
      const executionContext = createExecutionContext()
      const direct = await app.request('http://localhost/api/task-types', { headers }, env, executionContext)
      await waitOnExecutionContext(executionContext)
      expect(direct.status).toBe(400)
      expect(warnSpy).toHaveBeenCalledWith(
        'An authorized workspace subdomain was ignored because WORKSPACE_SUBDOMAIN_ROUTING is off; rejecting request',
      )
      for (const [warning] of warnSpy.mock.calls) {
        expect(String(warning)).not.toContain(fixture.token)
        expect(String(warning)).not.toContain(fixture.workspace.slug)
      }
    } finally {
      warnSpy.mockRestore()
    }
  })
})
