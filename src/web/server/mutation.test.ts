import { Effect } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { assertSameOriginMutation, checkSameOriginMutation } from './mutation'

const url = 'https://front.example.test/_effront/mutation'

describe('native browser mutation origin policy', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('allows explicit same-origin %s requests', async (method) => {
    const request = new Request(url, {
      method,
      headers: { origin: 'https://front.example.test', 'sec-fetch-site': 'same-origin' },
    })
    expect(() => assertSameOriginMutation(request)).not.toThrow()
    await expect(Effect.runPromise(checkSameOriginMutation(request))).resolves.toBeUndefined()
  })

  it.each([
    ['missing origin', 'POST', {}],
    ['cross-origin', 'POST', { origin: 'https://evil.example.test' }],
    ['different scheme', 'POST', { origin: 'http://front.example.test' }],
    ['different port', 'POST', { origin: 'https://front.example.test:8443' }],
    ['opaque origin', 'POST', { origin: 'null' }],
    ['deceptive hostname', 'POST', { origin: 'https://front.example.test.evil.test' }],
    ['cross-site fetch metadata', 'POST', { origin: 'https://front.example.test', 'sec-fetch-site': 'cross-site' }],
    ['read method GET', 'GET', { origin: 'https://front.example.test' }],
    ['read method HEAD', 'HEAD', { origin: 'https://front.example.test' }],
  ] satisfies readonly (readonly [string, string, HeadersInit])[])('rejects %s', async (_label, method, headers) => {
    const request = new Request(url, { method, headers })
    expect(() => assertSameOriginMutation(request)).toThrow('A same-origin mutation request is required.')
    await expect(Effect.runPromise(checkSameOriginMutation(request))).rejects.toMatchObject({
      _tag: 'ApiError',
      kind: 'request',
      status: 403,
      message: 'A same-origin mutation request is required.',
    })
  })
})
