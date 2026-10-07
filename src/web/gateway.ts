import { Effect, pipe, Result, Stream } from "effect";
import {
	Cookies,
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/http";
import type { Env } from "./request";
import { ApiError } from "./server";

const forwardedHeaders = [
	"accept",
	"authorization",
	"cf-access-jwt-assertion",
	"x-workspace-slug",
	"range",
	"if-none-match",
] as const;

/** Fixed-origin transport only. Authorization and business logic remain in the API Worker. */
export function forwardApi(
	request: Request,
	env: Pick<Env, "API_BASE">,
): Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const incoming = HttpServerRequest.fromWeb(request);
		const url = new URL(request.url);
		const origin = new URL(env.API_BASE);
		const local =
			origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
		// Credentials may only go to the configured HTTPS origin or a local development API.
		if (
			(!local && origin.protocol !== "https:") ||
			origin.username ||
			origin.password ||
			origin.pathname !== "/" ||
			origin.search ||
			origin.hash
		)
			return yield* Effect.fail(new ApiError("configuration", 500, "Invalid API origin."));
		if (incoming.method !== "GET" && incoming.method !== "HEAD")
			return yield* Effect.fail(
				new ApiError("configuration", 405, "Only document and file reads use this transport."),
			);

		let headers = Headers.empty;
		for (const name of forwardedHeaders) {
			const value = incoming.headers[name];
			if (value) headers = Headers.set(headers, name, value);
		}
		const authorization = Cookies.parseHeader(incoming.headers.cookie ?? "").CF_Authorization;
		if (authorization) {
			const credential = Cookies.set(Cookies.empty, "CF_Authorization", authorization);
			if (Result.isSuccess(credential))
				headers = Headers.set(headers, "cookie", Cookies.toCookieHeader(credential.success));
		}

		const target = new URL(`${url.pathname}${url.search}`, origin);
		const outgoing = HttpClientRequest.make(incoming.method)(target).pipe(
			HttpClientRequest.setHeaders(headers),
		);
		const upstream = yield* HttpClient.execute(outgoing).pipe(
			Effect.mapError(() => new ApiError("network", 502, "The API is temporarily unavailable.")),
		);

		if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
			if (url.pathname === "/auth/login" && incoming.method === "GET" && upstream.status === 302) {
				const location = upstream.headers.location;
				const destination = location?.startsWith("/")
					? new URL(location, url.origin)
					: new URL("/", url.origin);
				return HttpServerResponse.redirect(
					destination.origin === url.origin
						? `${destination.pathname}${destination.search}${destination.hash}`
						: "/",
					{
						status: 302,
						headers: { "cache-control": "private, no-store" },
					},
				);
			}
			return HttpServerResponse.jsonUnsafe(
				{ error: "The API requires a new authenticated session." },
				{
					status: 401,
					headers: { "cache-control": "private, no-store" },
				},
			);
		}

		const responseHeaders = pipe(
			upstream.headers,
			Headers.removeMany([
				"connection",
				"transfer-encoding",
				"access-control-allow-origin",
				"access-control-allow-credentials",
				"set-cookie",
			]),
			Headers.set("cache-control", "private, no-store"),
			Headers.set("x-content-type-options", "nosniff"),
		);
		if ([204, 205, 304].includes(upstream.status) || incoming.method === "HEAD")
			return HttpServerResponse.empty({ status: upstream.status, headers: responseHeaders });
		// The Web stream owns the Effect stream fiber until consumption/cancellation, not just until headers resolve.
		const body = yield* Stream.toReadableStreamEffect(upstream.stream);
		return HttpServerResponse.raw(body, { status: upstream.status, headers: responseHeaders });
	});
}
