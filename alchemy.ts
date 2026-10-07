import { makeApplicationHttpEffect } from "@effront/alchemy/cloudflare";
import { ALCHEMY_DEV, ALCHEMY_PHASE, RemovalPolicy } from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import {
	Request as WorkerRequest,
	type WorkerBinding,
	type WorkerBindingProps,
} from "alchemy/Cloudflare/Workers";
import { Config, Effect, Option, Redacted } from "effect";
import { HttpServerResponse } from "effect/http";
import { forwardApi } from "./src/web/gateway";
import { HttpClientLive } from "./src/web/http-client-layer";
import { sessionNavigation } from "./src/web/session-navigation";

/** Existing production identities. Storage and Access remain operator-owned. */
export const deployment = {
	accountId: "5643a837ef66765e7881c0831a36ebed",
	api: {
		name: "projektor",
		hostname: "projektor-api.totto2727.dev",
		origin: "https://projektor-api.totto2727.dev",
		main: "./src/api/index.ts",
		compatibility: {
			date: "2024-09-23",
			flags: ["nodejs_compat", "global_fetch_strictly_public", "cache_option_enabled"],
		},
		crons: ["0 3 * * *"],
	},
	frontend: {
		name: "projektor-frontend",
		hostname: "projektor.totto2727.dev",
		origin: "https://projektor.totto2727.dev",
	},
	storage: {
		database: { id: "e852f9c2-e817-409e-bbf0-3168e82a1afc", name: "projektor" },
		cache: { id: "b5598fbbbc2e48e3beab8bf9aecfc4bd", title: "projektor" },
		oauth: { id: "b187546f271142419343787032f6ca9b", title: "projektor-oauth" },
		files: { name: "projektor-files" },
	},
	access: {
		teamDomain: "totto2727.cloudflareaccess.com",
		audience: "327e65a1c53f85fa45155ffe4b7e1e8c35740cce3efc70b1f161392f5144ddb9",
		domain: "projektor.totto2727.dev",
	},
};

export const localDevelopment = {
	userEmail: "dev@projektor.local",
	jwtSecret: "projektor-local-development-only-secret",
};

/** Public bindings grant access to existing IDs without declaring a storage lifecycle. */
export function existingStorageBindings(): WorkerBinding[] {
	return [
		{ type: "d1", name: "DB", databaseId: deployment.storage.database.id },
		{ type: "kv_namespace", name: "KV", namespaceId: deployment.storage.cache.id },
		{ type: "kv_namespace", name: "OAUTH_KV", namespaceId: deployment.storage.oauth.id },
		{ type: "r2_bucket", name: "R2", bucketName: deployment.storage.files.name },
	];
}

export function apiVariables(
	local: boolean,
	devUserEmail = localDevelopment.userEmail,
): Record<string, string> {
	const common = {
		CF_ACCESS_TEAM_DOMAIN: deployment.access.teamDomain,
		CF_ACCESS_AUDIENCE: deployment.access.audience,
		DEFAULT_WORKSPACE_SLUG: "projektor",
		DEFAULT_WORKSPACE_NAME: "Projektor",
		AUTO_JOIN_ROLE: "none",
	};
	return local
		? {
				...common,
				ENVIRONMENT: "development",
				ADMIN_EMAILS: devUserEmail,
				DEV_USER_EMAIL: devUserEmail,
			}
		: { ...common, ENVIRONMENT: "production", ADMIN_EMAILS: "kaihatu.totto2727@gmail.com" };
}

/** Omit production input to inherit the existing secret without reading or rotating it. */
export function jwtSecret(local: boolean) {
	return local
		? Effect.succeed(Redacted.make(localDevelopment.jwtSecret))
		: Config.Redacted("JWT_SECRET").pipe(
				Config.option,
				Effect.map(Option.getOrUndefined),
				Effect.orDie,
			);
}

export const LocalDatabase = Cloudflare.D1.Database("LocalDatabase", {
	name: "projektor-local",
	migrations: "./migrations",
});

const apiIdentity = {
	name: deployment.api.name,
	main: deployment.api.main,
	compatibility: deployment.api.compatibility,
	workersDev: { enabled: false, previewsEnabled: false },
	domain: { name: deployment.api.hostname, previews: false },
	crons: deployment.api.crons,
};

export const Api = Cloudflare.Worker(
	"Api",
	Effect.gen(function* () {
		// Worker capture resolves symbolic identity only, without deployment inputs or children.
		if ((yield* ALCHEMY_PHASE) === "runtime") return apiIdentity;
		const local = yield* ALCHEMY_DEV;
		const secret = yield* jwtSecret(local);
		const secretEnv: WorkerBindingProps = secret === undefined ? {} : { JWT_SECRET: secret };
		const devUserEmail = local
			? yield* Config.String("DEV_USER_EMAIL").pipe(
					Config.withDefault(localDevelopment.userEmail),
					Effect.orDie,
				)
			: localDevelopment.userEmail;
		const storage: WorkerBindingProps = local
			? {
					DB: yield* LocalDatabase,
					KV: yield* Cloudflare.KV.Namespace("LocalCache", { title: "projektor-local" }),
					OAUTH_KV: yield* Cloudflare.KV.Namespace("LocalOAuth", {
						title: "projektor-oauth-local",
					}),
					R2: yield* Cloudflare.R2.Bucket("LocalFiles", { name: "projektor-files-local" }),
				}
			: {};
		return {
			...apiIdentity,
			env: {
				...apiVariables(local, devUserEmail),
				...storage,
				...secretEnv,
				// Preserve the deployed name/class. WorkspaceHub stays unbound, no old migrations replay.
				RATE_LIMITER: Cloudflare.DurableObject("RateLimiter", { className: "RateLimiter" }),
			},
		};
	}),
).pipe(
	adopt(
		ALCHEMY_DEV.pipe(
			Effect.map((local) => !local),
			Effect.orDie,
		),
	),
	RemovalPolicy.retain(),
);

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
			vite: { rootDir: ".", viteEnvironments: { entry: "rsc", children: ["ssr"] } },
		};
	}),
	Effect.gen(function* () {
		const application = yield* makeApplicationHttpEffect(() =>
			import("./src/web/entry.effront").then((module) => module.default),
		);
		const fetch = Effect.gen(function* () {
			const request = yield* WorkerRequest;
			const url = new URL(request.url);
			if (url.pathname === "/auth/session") return yield* sessionNavigation(request);
			if (
				(request.method === "GET" || request.method === "HEAD") &&
				(url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/files/"))
			) {
				const headers = new Headers(request.headers);
				const workspace = url.searchParams.get("workspace");
				if (url.pathname.startsWith("/api/files/") && workspace)
					headers.set("X-Workspace-Slug", workspace);
				return yield* forwardApi(new Request(request, { headers }), {
					API_BASE: deployment.api.origin,
				}).pipe(Effect.provide(HttpClientLive));
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

export default Frontend.pipe(
	adopt(true),
	RemovalPolicy.retain(),
	Effect.tap((frontend) =>
		Effect.gen(function* () {
			if ((yield* ALCHEMY_PHASE) === "runtime") return;
			if (!(yield* ALCHEMY_DEV)) {
				yield* frontend.bind("external-database", {
					bindings: existingStorageBindings().filter((binding) => binding.type === "d1"),
				});
			}
		}),
	),
);
