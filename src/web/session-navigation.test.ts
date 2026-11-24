import { Effect } from 'effect'
import { HttpServerResponse } from 'effect/http'
import { describe, expect, test } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'

import { sessionNavigation as navigate } from './session-navigation.ts'

const sessionNavigation = (request: Request): Promise<Response> =>
  runTestEffect(navigate(request).pipe(Effect.map(HttpServerResponse.toWeb)))

const origin = 'https://frontend.example'
const form = function form(
  fields: Record<string, string>,
  requestOrigin = origin,
): Request<unknown, CfProperties<unknown>> {
  return new Request(`${origin}/auth/session`, {
    method: 'POST',
    headers: { origin: requestOrigin },
    body: new URLSearchParams(fields),
  })
}

describe('native session document navigation', () => {
  test('redirects a native login POST back to the same scoped local page', async () => {
    const path = '/issues?workspace=beta&projectId=p#active'
    const response = await sessionNavigation(form({ action: 'login', redirect_url: path }))
    expect(response.status).toBe(303)
    const target = new URL(response.headers.get('location') ?? '', origin)
    expect(target.pathname).toBe('/auth/login')
    expect(target.searchParams.get('redirect_url')).toBe(path)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('redirects logout only to the same-origin Access document endpoint', async () => {
    const response = await sessionNavigation(form({ action: 'logout', redirect_url: 'https://evil.example' }))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/cdn-cgi/access/logout')
  })

  test.each(['https://evil.example/', '//evil.example/', '/\\evil.example/', 'javascript:alert(1)'])(
    'rejects nonlocal login redirect %s',
    async (redirect_url) => {
      await expect(sessionNavigation(form({ action: 'login', redirect_url }))).rejects.toMatchObject({ status: 400 })
    },
  )

  test('rejects cross-origin POST, oversized forms, unsupported actions and non-POST navigation', async () => {
    await expect(sessionNavigation(form({ action: 'logout' }, 'https://evil.example'))).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      sessionNavigation(form({ action: 'login', redirect_url: `/${'x'.repeat(8192)}` })),
    ).rejects.toMatchObject({ status: 400 })
    await expect(sessionNavigation(form({ action: 'unknown' }))).rejects.toMatchObject({
      status: 400,
    })
    const result = await sessionNavigation(new Request(`${origin}/auth/session`))
    expect(result.status).toBe(405)
  })
})
