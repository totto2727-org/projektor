import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type { ReactNode } from "react";
import { RuntimeProvider } from "./client/runtime";
import { ProjectNav } from "./components/ProjectNav";
import { EFFRONT } from "./effront";
import {
	getRouteParams,
	type PageFailure,
	type PreparedView,
	RequestServices,
	type RouteParams,
} from "./request";
import { ScopeSelection } from "./selection";
import type { RequestApi, RequestScope, ScopeOptions } from "./server";

export type RouteRenderer = (
	api: RequestApi,
	scope: RequestScope,
	url: URL,
	params: RouteParams,
) => Effect.Effect<ReactNode, PageFailure, RequestServices>;
export type PublicRenderer = (
	api: RequestApi,
	scope: null,
	url: URL,
	params: RouteParams,
) => Effect.Effect<ReactNode, PageFailure, RequestServices>;

function errorResponse(error: PageFailure) {
	const status = error.status;
	const message =
		status === 401
			? "Your session has expired. Refresh this page to sign in."
			: status === 403
				? "You do not have access to this workspace or project."
				: status === 404
					? "The requested page was not found."
					: status === 400
						? "The page address is invalid."
						: "The page is temporarily unavailable. Please try again.";
	return HttpServerResponse.text(
		`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Projektor</title><main><h1>${message}</h1><a href="/">View projects</a></main></html>`,
		{
			status,
			contentType: "text/html; charset=utf-8",
			headers: { "cache-control": "private, no-store" },
		},
	);
}

/** Prepare typed initial data before HTTP streaming, preserving denial/error statuses. */
export function pageRenderer(
	render: RouteRenderer | PublicRenderer,
	options: ScopeOptions & { public?: boolean; projectNav?: boolean } = {},
) {
	const view: PreparedView = Effect.gen(function* () {
		const services = yield* RequestServices;
		const params = yield* getRouteParams;
		const scope = options.public ? null : yield* services.scope(options);
		let content: ReactNode;
		if (scope === null) {
			content = yield* (render as PublicRenderer)(services.api, null, services.url, params);
		} else if (scope.selection.kind === "selection-required") {
			content = <ScopeSelection scope={scope} url={services.url} />;
		} else {
			content = yield* (render as RouteRenderer)(services.api, scope, services.url, params);
		}
		return (
			<RuntimeProvider key={services.url.href} scope={scope} url={services.url.href}>
				{options.projectNav && scope?.selection.kind === "project" && (
					<ProjectNav scope={scope} url={services.url.href} />
				)}
				{content}
			</RuntimeProvider>
		);
	});
	const prepare = Effect.gen(function* () {
		const services = yield* RequestServices;
		return yield* services.prepare(view);
	});
	const Check = EFFRONT.Middleware.make((httpEffect) =>
		Effect.gen(function* () {
			const { request } = yield* RequestServices;
			// Mutate first, then refresh. A POST must never preload stale primary data.
			if (request.method !== "GET" && request.method !== "HEAD") return yield* httpEffect;
			const prepared = yield* prepare.pipe(Effect.result);
			if (prepared._tag === "Failure") return errorResponse(prepared.failure);
			return yield* httpEffect;
		}),
	);
	return { factory: EFFRONT.withMiddleware(Check), render: () => prepare };
}
