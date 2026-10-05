import { makeApplicationHttpEffect } from "@effront/alchemy/cloudflare";
import * as Cloudflare from "alchemy/Cloudflare";
import { ALCHEMY_DEV, ALCHEMY_PHASE, RemovalPolicy } from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import {
	Request as WorkerRequest,
	WorkerEnvironment,
	type WorkerBindingProps,
} from "alchemy/Cloudflare/Workers";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { Api, LocalDatabase } from "../../../infra/api";
import { deployment } from "../../../infra/config";
import { forwardApi } from "./gateway";
import { HttpClientLive } from "./http-client-layer";
import type { Env } from "./request";
import { sessionNavigation } from "./session-navigation";

class Frontend extends Cloudflare.Worker<Frontend>()(
	"Frontend",
	Effect.gen(function* () {
		const localDatabase: WorkerBindingProps =
			(yield* ALCHEMY_PHASE) !== "runtime" && (yield* ALCHEMY_DEV)
				? { DB: yield* LocalDatabase }
				: {};
		return {
			name: deployment.frontend.name,
			main: import.meta.url,
			compatibility: { date: "2026-09-01", flags: ["nodejs_compat"] },
			workersDev: { enabled: false, previewsEnabled: false },
			domain: { name: deployment.frontend.hostname, previews: false },
			env: { API: Api, API_BASE: deployment.api.origin, ...localDatabase },
			vite: {
				rootDir: "apps/web",
				viteEnvironments: { entry: "rsc", children: ["ssr"] },
			},
		};
	}),
	Effect.gen(function* () {
		const application = yield* makeApplicationHttpEffect(() =>
			import("./entry.effront").then((module) => module.default),
		);
		const fetch = Effect.gen(function* () {
			const request = yield* WorkerRequest;
			const url = new URL(request.url);
			if (url.pathname === "/auth/session") return yield* sessionNavigation(request);
			if (
				(request.method === "GET" || request.method === "HEAD") &&
				(url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/files/"))
			) {
				const env = yield* WorkerEnvironment;
				const headers = new Headers(request.headers);
				const workspace = url.searchParams.get("workspace");
				if (url.pathname.startsWith("/api/files/") && workspace)
					headers.set("X-Workspace-Slug", workspace);
				return yield* forwardApi(new Request(request, { headers }), env as unknown as Env).pipe(
					Effect.provide(HttpClientLive),
				);
			}
			return yield* application;
		}).pipe(
			Effect.catchTag("ApiError", (error) =>
				Effect.succeed(
					HttpServerResponse.jsonUnsafe(
						{ error: error.message },
						{ status: error.status, headers: { "cache-control": "private, no-store" } },
					),
				),
			),
			Effect.orDie,
		);
		return { fetch };
	}),
) {}

export default Frontend.pipe(adopt(true), RemovalPolicy.retain());
