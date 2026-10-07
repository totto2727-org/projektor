import { Effect } from 'effect'
import { HttpClientRequest, HttpClientResponse } from 'effect/http'

import type { RequestApi } from '../../server/api-client'

/** HTTP boundary fixture only. Domain handlers still execute and decode their own responses. */
export function testRequestApi(execute: RequestApi['execute']): RequestApi {
  const raw: RequestApi['raw'] = (path, options = {}) => {
    const request = HttpClientRequest.make(options.method ?? 'GET')(path)
    const scoped = options.workspaceSlug
      ? HttpClientRequest.setHeader(request, 'x-workspace-slug', options.workspaceSlug)
      : request
    return options.body instanceof FormData ? HttpClientRequest.bodyFormData(scoped, options.body) : scoped
  }
  return {
    get: (path, options = {}) => raw(path, options),
    send: (path, options) => {
      const request = raw(path, options)
      return options.json === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, options.json)
    },
    raw,
    execute,
  }
}

export function jsonResponse(request: HttpClientRequest.HttpClientRequest, value: unknown) {
  return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(value)))
}
