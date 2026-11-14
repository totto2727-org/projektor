import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vite-plus/test'

import { env } from './fixture-api'
import { authHeaders, seedFixture, seedMember, seedProject, seedUserToken, seedWorkspace } from './helpers'

describe('credential confinement for user-level operations', () => {
  it('workspace credentials see only their workspace in REST catalogs and auth bootstrap', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const other = await seedWorkspace()
    await seedMember(other.id, fixture.user.id, 'owner')
    const ownProject = await seedProject(fixture.workspace.id, 'OWN')
    const otherProject = await seedProject(other.id, 'OTHER')
    const headers = authHeaders(fixture.token, fixture.workspace.slug)

    for (const path of ['/api/workspaces', '/auth/me']) {
      const response = await SELF.fetch(`http://localhost${path}`, { headers })
      expect(response.status).toBe(200)
      const body = await response.json<{ id: string }[] | { workspaces: { id: string }[] }>()
      const workspaces = Array.isArray(body) ? body : body.workspaces
      expect(workspaces.map((workspace) => workspace.id)).toEqual([fixture.workspace.id])
    }

    const response = await SELF.fetch('http://localhost/api/projects', { headers })
    expect(response.status).toBe(200)
    const projects = await response.json<{ id: string }[]>()
    expect(projects.map((project) => project.id)).toContain(ownProject.id)
    expect(projects.map((project) => project.id)).not.toContain(otherProject.id)
  })

  it('user-scoped credentials retain access to their own cross-workspace catalog', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const other = await seedWorkspace()
    await seedMember(other.id, fixture.user.id, 'owner')
    const token = await seedUserToken(fixture.user.id)
    const response = await SELF.fetch('http://localhost/api/workspaces', {
      headers: authHeaders(token, fixture.workspace.slug),
    })
    expect(response.status).toBe(200)
    const workspaces = await response.json<{ id: string }[]>()
    expect(workspaces.map((workspace) => workspace.id)).toEqual(
      expect.arrayContaining([fixture.workspace.id, other.id]),
    )
  })

  it('workspace credentials cannot create an unconfined workspace', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const slug = `confined-${crypto.randomUUID()}`
    const response = await SELF.fetch('http://localhost/api/workspaces', {
      method: 'POST',
      headers: authHeaders(fixture.token, fixture.workspace.slug),
      body: JSON.stringify({ slug, name: 'Not authorized' }),
    })
    expect(response.status).toBe(403)
    expect(await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first()).toBeNull()
  })

  it('bearer credentials cannot list or revoke personal connectors', async () => {
    const fixture = await seedFixture({ role: 'owner' })
    const pat = await seedUserToken(fixture.user.id)
    for (const token of [fixture.token, pat]) {
      for (const method of ['GET', 'DELETE']) {
        const suffix = method === 'DELETE' ? '/unknown-grant' : ''
        const response = await SELF.fetch(
          `http://localhost/api/workspaces/${fixture.workspace.slug}/connectors${suffix}`,
          {
            method,
            headers: authHeaders(token, fixture.workspace.slug),
          },
        )
        expect(response.status).toBe(403)
      }
    }
  })
})
