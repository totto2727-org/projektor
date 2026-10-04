import { createFetchHandler } from "@effront/core/workers";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import application from "./entry.effront";
import { forwardApi } from "./gateway";
import { HttpClientLive } from "./http-client-layer";
import type { Env } from "./request";
import { sessionNavigation } from "./session-navigation";

const handle = createFetchHandler(application);

export default {
	async fetch(request: Request, env: Env, context: unknown): Promise<Response> {
		const url = new URL(request.url);
		// Only transport/document interfaces sit outside Effront's registered page routes.
		const nativeFile =
			(request.method === "GET" || request.method === "HEAD") &&
			url.pathname.startsWith("/api/files/");
		const session = url.pathname === "/auth/session";
		const login = request.method === "GET" && url.pathname === "/auth/login";
		// Downloads/images and session document navigation are not ServerFn JSON operations.
		// There is no general browser API proxy or upload route around Effront's request limit.
		if (nativeFile || session || login) {
			const response =
				url.pathname === "/auth/session" ? sessionNavigation(request) : forwardApi(request, env);
			return Effect.runPromise(
				response.pipe(
					Effect.catchTag("ApiError", (error) =>
						Effect.succeed(
							HttpServerResponse.jsonUnsafe(
								{ error: error.message },
								{ status: error.status, headers: { "cache-control": "private, no-store" } }
							)
						)
					),
					Effect.map(HttpServerResponse.toWeb),
					Effect.provide(HttpClientLive)
				),
				{ signal: request.signal }
			);
		}
		if (url.pathname === "/projects" || url.pathname === "/projects/")
			return HttpServerResponse.toWeb(
				HttpServerResponse.redirect(`/${url.search}`, { status: 308 })
			);
		return handle(request, env, context);
	},
};
