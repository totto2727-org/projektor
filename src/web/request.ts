import type { D1Database } from "@cloudflare/workers-types";
import { Request as WorkerRequest, WorkerEnvironment } from "alchemy/Cloudflare/Workers";
import { Cache, Context, Data, Effect, Exit, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import type { ReactNode } from "react";
import {
	type ApiError,
	createRequestApi,
	loadRequestScope,
	type RequestApi,
	type RequestScope,
	type ScopeError,
	type ScopeOptions,
} from "./server";

export interface Env {
	readonly API_BASE: string;
	readonly DB: D1Database;
}

export type PageFailure = ApiError | ScopeError;
export type PreparedView = Effect.Effect<Awaited<ReactNode>, PageFailure, RequestServices>;

class ScopeKey extends Data.Class<ScopeOptions> {}

export type RouteParams = Readonly<Record<string, string | undefined>>;
/** Read the framework's matched route, never match or decode the path again. */
export const getRouteParams: Effect.Effect<RouteParams> = Effect.serviceOption(
	HttpRouter.RouteContext,
).pipe(Effect.map((context) => (Option.isSome(context) ? context.value.params : {})));

export class RequestServices extends Context.Service<
	RequestServices,
	{
		readonly request: Request;
		readonly env: Env;
		readonly url: URL;
		readonly api: RequestApi;
		readonly db: D1Database;
		readonly scope: (options?: ScopeOptions) => Effect.Effect<RequestScope, PageFailure>;
		readonly prepare: (view: PreparedView) => PreparedView;
		readonly invalidate: Effect.Effect<void>;
	}
>()("projektor/ssr/RequestServices") {}

/** Construct services without creating a nested runtime or any cross-request cache. */
export const makeRequestServices = (request: Request, env: Env) =>
	Effect.gen(function* () {
		const url = new URL(request.url);
		const api = yield* createRequestApi(request, { apiBaseUrl: env.API_BASE });
		const scopes = yield* Cache.makeWith(
			(options: ScopeOptions) => loadRequestScope(api, url, options, { db: env.DB, request }),
			{ capacity: 32, timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0) },
		);
		const views = yield* Cache.makeWith((view: PreparedView) => view, {
			capacity: 32,
			requireServicesAt: "lookup",
			timeToLive: (exit) => (Exit.isSuccess(exit) ? Infinity : 0),
		});
		return {
			request,
			env,
			url,
			api,
			db: env.DB,
			scope: (options: ScopeOptions = {}) =>
				getRouteParams.pipe(
					Effect.flatMap((params) =>
						Cache.get(
							scopes,
							new ScopeKey({ ...options, projectHint: options.projectHint ?? params.projectSlug }),
						),
					),
				),
			prepare: (view: PreparedView) => Cache.get(views, view),
			invalidate: Effect.gen(function* () {
				yield* Cache.invalidateAll(scopes);
				yield* Cache.invalidateAll(views);
			}),
		};
	});

/** Effront owns this Layer and its caches for one request through streaming completion. */
export const RequestServicesLive = Layer.effect(
	RequestServices,
	Effect.gen(function* () {
		const request = yield* WorkerRequest;
		const env = yield* WorkerEnvironment;
		return yield* makeRequestServices(request, env as unknown as Env);
	}),
);
