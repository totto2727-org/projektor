import { fromCloudflareFetcher, toHttpClient } from 'alchemy/Cloudflare'
import { WorkerEnvironment } from 'alchemy/Cloudflare/Workers'
import { Effect, Layer } from 'effect'
import { HttpClient, HttpClientError, HttpClientRequest } from 'effect/http'

export function serviceBindingHttpClient(fetcher: Parameters<typeof fromCloudflareFetcher>[0]): HttpClient.HttpClient {
  // The pinned adapter has no redirect option and builds a default-follow Web Request.
  // Preserve API status/Location for the gateway and keep credentials off redirect targets.
  const manualRedirectFetcher = {
    fetch(request: Request, options?: RequestInit) {
      // Match the public adapter's native Fetcher narrowing across CF/DOM overloads.
      return (fetcher as globalThis.Fetcher).fetch(new Request(request, { redirect: 'manual' }), options)
    },
  } as Parameters<typeof fromCloudflareFetcher>[0]
  return toHttpClient(fromCloudflareFetcher(manualRedirectFetcher)).pipe(
    HttpClient.mapRequestEffect((request) => {
      if (request.body._tag !== 'FormData') return Effect.succeed(request)
      const formData = request.body.formData
      // Alchemy 2.0.0-beta.81 uses Effect 4.0.1's fromClientRequest/toWeb.
      // That path streams FormData via Response but drops its generated boundary header.
      // Encode once here so the official adapter forwards matching bytes and Content-Type.
      return Effect.tryPromise({
        try: async () => {
          const encoded = new Response(formData)
          return HttpClientRequest.bodyUint8Array(
            request,
            new Uint8Array(await encoded.arrayBuffer()),
            encoded.headers.get('content-type')!,
          )
        },
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      })
    }),
  )
}

/** The native service binding keeps all API calls inside the server-side Worker graph. */
export const HttpClientLive = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const env = yield* WorkerEnvironment
    return serviceBindingHttpClient(env.API as Parameters<typeof fromCloudflareFetcher>[0])
  }),
)
