import { Effect, Result, type Scope } from "effect";
import {
	Cookies,
	Headers,
	HttpBody,
	HttpClient,
	HttpClientRequest,
	type HttpClientResponse,
} from "effect/http";
import { ApiError } from "./errors";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };
export interface ApiReadOptions {
	readonly workspaceSlug?: string;
}
export interface ApiMutationOptions extends ApiReadOptions {
	readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
	readonly json?: JsonValue;
}
export interface ApiRawOptions extends ApiReadOptions {
	readonly method?: "GET" | "HEAD" | ApiMutationOptions["method"];
	readonly body?: BodyInit;
	readonly contentType?: string;
	readonly accept?: string;
}

/** Builders return Effect HTTP requests. Each operation owns its response schema. */
export interface RequestApi {
	get(path: string, options?: ApiReadOptions): HttpClientRequest.HttpClientRequest;
	send(path: string, options: ApiMutationOptions): HttpClientRequest.HttpClientRequest;
	raw(path: string, options?: ApiRawOptions): HttpClientRequest.HttpClientRequest;
	/** Execution only. The caller scopes and decodes the response with Effect HTTP. */
	execute(
		request: HttpClientRequest.HttpClientRequest,
	): Effect.Effect<HttpClientResponse.HttpClientResponse, ApiError, Scope.Scope>;
}
export interface RequestApiOptions {
	readonly apiBaseUrl: string;
}

function apiOrigin(value: string): Effect.Effect<URL, ApiError> {
	return Effect.try({
		try: () => new URL(value),
		catch: (cause) =>
			new ApiError("configuration", 500, "The API origin is not configured correctly.", cause),
	}).pipe(
		Effect.flatMap((url) => {
			const local =
				url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
			return (url.protocol !== "https:" && !local) ||
				url.username ||
				url.password ||
				url.pathname !== "/" ||
				url.search ||
				url.hash
				? Effect.fail(
						new ApiError("configuration", 500, "The API origin is not configured correctly."),
					)
				: Effect.succeed(url);
		}),
	);
}
function requestIdentity(request: Request): Headers.Headers {
	const incoming = Headers.fromInput(request.headers);
	let headers = Headers.empty;
	const authorization = incoming.authorization;
	if (authorization?.startsWith("Bearer "))
		headers = Headers.set(headers, "authorization", authorization);
	const assertion = incoming["cf-access-jwt-assertion"];
	if (assertion) headers = Headers.set(headers, "cf-access-jwt-assertion", assertion);
	const credential = Cookies.parseHeader(incoming.cookie ?? "").CF_Authorization;
	if (credential !== undefined) {
		const allowed = Cookies.set(Cookies.empty, "CF_Authorization", credential);
		if (Result.isSuccess(allowed))
			headers = Headers.set(headers, "cookie", Cookies.toCookieHeader(allowed.success));
	}
	return headers;
}
export function assertSameOriginMutation(request: Request): void {
	if (
		request.method === "GET" ||
		request.method === "HEAD" ||
		request.headers.get("origin") !== new URL(request.url).origin ||
		request.headers.get("sec-fetch-site") === "cross-site"
	) {
		throw new ApiError("request", 403, "A same-origin mutation request is required.");
	}
}
export function checkSameOriginMutation(request: Request): Effect.Effect<void, ApiError> {
	return Effect.try({
		try: () => assertSameOriginMutation(request),
		catch: (error) => {
			if (error instanceof ApiError) return error;
			throw error;
		},
	});
}
function whenAborted(signal: AbortSignal): Effect.Effect<void> {
	return Effect.callback((resume) => {
		const abort = () => resume(Effect.void);
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		return Effect.sync(() => signal.removeEventListener("abort", abort));
	});
}

/** Request-local trusted identity and execution. There is no DTO decoder or result cache here. */
export function createRequestApi(
	request: Request,
	options: RequestApiOptions,
): Effect.Effect<RequestApi, ApiError, HttpClient.HttpClient> {
	return Effect.gen(function* () {
		const origin = yield* apiOrigin(options.apiBaseUrl);
		const client = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
		const identity = requestIdentity(request);
		function raw(path: string, options: ApiRawOptions = {}): HttpClientRequest.HttpClientRequest {
			let headers = Headers.set(identity, "accept", options.accept ?? "application/json");
			if (options.workspaceSlug)
				headers = Headers.set(headers, "x-workspace-slug", options.workspaceSlug);
			if (options.contentType) headers = Headers.set(headers, "content-type", options.contentType);
			const base = HttpClientRequest.make(options.method ?? "GET")(new URL(path, origin)).pipe(
				HttpClientRequest.setHeaders(headers),
			);
			if (options.body instanceof FormData)
				return HttpClientRequest.bodyFormData(base, options.body);
			return options.body === undefined
				? base
				: HttpClientRequest.setBody(
						base,
						HttpBody.raw(options.body, { contentType: options.contentType }),
					);
		}
		function execute(
			outgoing: HttpClientRequest.HttpClientRequest,
		): Effect.Effect<HttpClientResponse.HttpClientResponse, ApiError, Scope.Scope> {
			return Effect.gen(function* () {
				if (request.signal.aborted) return yield* Effect.interrupt;
				if (outgoing.method !== "GET" && outgoing.method !== "HEAD")
					yield* checkSameOriginMutation(request);
				return yield* client.execute(outgoing).pipe(
					Effect.mapError(
						(cause) => new ApiError("network", 502, "The API is temporarily unavailable.", cause),
					),
					Effect.flatMap((response) => {
						if (response.status >= 300 && response.status < 400)
							return Effect.fail(
								new ApiError("redirect", 502, "The API requires a new authenticated session."),
							);
						if (response.status < 200 || response.status >= 300)
							return Effect.fail(
								new ApiError(
									"http",
									response.status,
									`The API request failed (${response.status}).`,
								),
							);
						return Effect.succeed(response);
					}),
					Effect.raceFirst(whenAborted(request.signal).pipe(Effect.andThen(Effect.interrupt))),
				);
			});
		}
		return {
			get: (path, options = {}) => raw(path, options),
			send: (path, options) => {
				const base = raw(path, options);
				return options.json === undefined
					? base
					: HttpClientRequest.bodyJsonUnsafe(base, options.json);
			},
			raw,
			execute,
		};
	});
}
