import { Stack } from "alchemy";
import { CloudflareEnvironment, Providers } from "alchemy/Cloudflare";
import { ConfigProvider, Effect, Exit, Redacted } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { Api, ApiDeploymentPreflight, LocalDatabase } from "./api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import {
	apiVariables,
	deployment,
	existingStorageBindings,
	jwtSecret,
	localDevelopment,
	productionAccessPrerequisite,
	requireExistingAccess,
	requireProductionAccount,
} from "./config";

function configured<A, E, R>(effect: Effect.Effect<A, E, R>, values: Record<string, string>) {
	return effect.pipe(
		Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values)),
	);
}

async function registerApi(local: boolean, accountId = deployment.accountId) {
	const stack: Stack["Service"] = {
		name: "projektor",
		stage: local ? "dev" : "production",
		resources: {},
		bindings: {},
		actions: {},
	};
	const { api } = await Effect.runPromise(
		configured(ApiDeploymentPreflight.pipe(Effect.andThen(Api)), {
			ALCHEMY_DEV: local ? "true" : "false",
			PROJEKTOR_ACCESS_CONFIRMED: "true",
			JWT_SECRET: "test-existing-production-value",
		}).pipe(
			// Resource output proxies are thenable. Wrap the value before it
			// crosses the native Promise boundary instead of assimilating it.
			Effect.map((api) => ({ api })),
			Effect.provideService(Stack, stack),
			Effect.provideService(
				CloudflareEnvironment,
				Effect.succeed({
					type: "apiToken",
					apiToken: Redacted.make("unused-test-only-token"),
					accountId,
					source: { type: "env" },
				}),
			),
			// Registration must not call any provider. A deliberately empty
			// collection keeps these tests independent of credentials/cloud APIs.
			Effect.provideService(Providers, {
				kind: "ProviderCollection",
				providers: {},
				get: () => undefined,
			}),
		),
	);
	return { api, stack };
}

describe("source-owned deployment configuration", () => {
	it.each([false, true])(
		"captures env.API without deployment inputs in runtime (dev=%s)",
		async (local) => {
			const stack: Stack["Service"] = {
				name: "projektor",
				stage: "testhost",
				resources: {},
				bindings: {},
				actions: {},
			};
			const reads: string[] = [];
			const provider = ConfigProvider.make((path) => {
				const key = path.join(".");
				reads.push(key);
				if (key === "ALCHEMY_PHASE") return Effect.succeed(ConfigProvider.makeValue("runtime"));
				if (key === "ALCHEMY_DEV") return Effect.succeed(ConfigProvider.makeValue(String(local)));
				return Effect.die(new Error(`Runtime read deployment input ${key}`));
			});
			await Effect.runPromise(
				Cloudflare.Worker("RuntimeFrontend", {
					name: "projektor-frontend",
					main: "./apps/web/src/entry.workers.ts",
					env: { API: Api },
				}).pipe(
					Effect.map((frontend) => ({ frontend })),
					Effect.provideService(Stack, stack),
					Effect.provideService(ConfigProvider.ConfigProvider, provider),
					Effect.provideService(
						CloudflareEnvironment,
						Effect.die(new Error("Runtime resolved deployment profile")),
					),
					Effect.provideService(Providers, {
						kind: "ProviderCollection",
						providers: {},
						get: () => {
							throw new Error("Runtime resolved lifecycle provider");
						},
					}),
				),
			);
			expect(Object.keys(stack.resources).sort()).toEqual(["Api", "RuntimeFrontend"]);
			expect(stack.resources.Api.Props).not.toHaveProperty("env");
			expect(stack.bindings.Api ?? []).toEqual([]);
			expect(new Set(reads)).toEqual(new Set(["ALCHEMY_PHASE", "ALCHEMY_DEV"]));
			const binding = stack.bindings.RuntimeFrontend.flatMap(
				(entry) => entry.data.bindings ?? [],
			)[0];
			expect(binding.type).toBe("service");
			expect(binding.name).toBe("API");
			expect(Output.isOutput(binding.service)).toBe(true);
			expect(binding.service.kind).toBe("PropExpr");
			expect(binding.service.identifier).toBe("workerName");
			expect(binding.service.expr.src.LogicalId).toBe("Api");
		},
	);

	it.each<{ accountId: string; values: Record<string, string>; error: string }>([
		{
			accountId: "testhost-account",
			values: { PROJEKTOR_ACCESS_CONFIRMED: "true", JWT_SECRET: "preserved" },
			error: "production account",
		},
		{
			accountId: deployment.accountId,
			values: { JWT_SECRET: "preserved" },
			error: "PROJEKTOR_ACCESS_CONFIRMED=true",
		},
		{
			accountId: deployment.accountId,
			values: { PROJEKTOR_ACCESS_CONFIRMED: "true" },
			error: "JWT_SECRET",
		},
	])(
		"fails production preflight before registration: $error",
		async ({ accountId, values, error }) => {
			const stack: Stack["Service"] = {
				name: "projektor",
				stage: "production",
				resources: {},
				bindings: {},
				actions: {},
			};
			await expect(
				Effect.runPromise(
					configured(
						ApiDeploymentPreflight.pipe(
							Effect.andThen(Api),
							Effect.map((api) => ({ api })),
						),
						values,
					).pipe(
						Effect.provideService(Stack, stack),
						Effect.provideService(
							CloudflareEnvironment,
							Effect.succeed({
								type: "apiToken",
								apiToken: Redacted.make("unused"),
								accountId,
								source: { type: "env" },
							}),
						),
						Effect.provideService(Providers, {
							kind: "ProviderCollection",
							providers: {},
							get: () => undefined,
						}),
					),
				),
			).rejects.toThrow(error);
			expect(stack.resources).toEqual({});
			expect(stack.bindings).toEqual({});
		},
	);

	it("shares one native local database between API and Frontend", async () => {
		const { api, stack } = await registerApi(true);
		const { db } = await Effect.runPromise(
			LocalDatabase.pipe(
				Effect.map((db) => ({ db })),
				Effect.provideService(Stack, stack),
				Effect.provideService(Providers, {
					kind: "ProviderCollection",
					providers: {},
					get: () => undefined,
				}),
			),
		);
		expect(api.Props.env).toMatchObject({ DB: db });
		expect(stack.resources.LocalDatabase).toBe(db);
		expect(Object.keys(stack.resources).filter((id) => id === "LocalDatabase")).toHaveLength(1);
	});
	it("checks the resolved account before creating the production Worker", async () => {
		expect(() => requireProductionAccount(deployment.accountId)).not.toThrow();
		expect(() => requireProductionAccount("different-account")).toThrow("production account");
		await expect(registerApi(false, "different-account")).rejects.toThrow("production account");
		// Local registration does not resolve/use a production account.
		await expect(registerApi(true, "different-account")).resolves.toBeDefined();
	});

	it("registers only the retained native Worker and external storage in production", async () => {
		const { api, stack } = await registerApi(false);
		expect(Object.keys(stack.resources)).toEqual(["Api"]);
		expect(api.RemovalPolicy).toBe("retain");
		expect(api.Adopt).toBe(true);
		const env = api.Props.env;
		if (!env) throw new Error("Production Worker is missing its environment");
		expect(Redacted.value(env.JWT_SECRET)).toBe("test-existing-production-value");
		expect(api.Props).toMatchObject({
			name: "projektor",
			main: "./apps/api/src/index.ts",
			workersDev: { enabled: false, previewsEnabled: false },
			domain: { name: "projektor-api.totto2727.dev", previews: false },
			crons: ["0 3 * * *"],
		});
		expect(api.Props).not.toHaveProperty("access");
		expect(api.Props).not.toHaveProperty("migrations");
		const bindings = stack.bindings.Api.flatMap((entry) => entry.data.bindings ?? []);
		for (const binding of existingStorageBindings()) expect(bindings).toContainEqual(binding);
		expect(bindings).toContainEqual(
			expect.objectContaining({
				type: "durable_object_namespace",
				name: "RATE_LIMITER",
				className: "RateLimiter",
			}),
		);
		expect(bindings.some((binding) => binding.className === "WorkspaceHub")).toBe(false);
	});

	it("declares separate local storage with local-only migrations for dev", async () => {
		const { api, stack } = await registerApi(true);
		expect(Object.keys(stack.resources).sort()).toEqual([
			"Api",
			"LocalCache",
			"LocalDatabase",
			"LocalFiles",
			"LocalOAuth",
		]);
		expect(stack.resources.LocalDatabase.Props).toMatchObject({
			name: "projektor-local",
			migrations: "./packages/db/migrations",
		});
		expect(api.Adopt).toBe(false);
		expect(api.Props.env).toMatchObject({
			ENVIRONMENT: "development",
			DEV_USER_EMAIL: localDevelopment.userEmail,
		});
		expect(stack.bindings.Api.some((entry) => entry.sid === "external-storage")).toBe(false);
	});

	it("preserves the production Worker names, domains, account and API entrypoint", () => {
		expect(deployment.accountId).toBe("5643a837ef66765e7881c0831a36ebed");
		expect(deployment.api.name).toBe("projektor");
		expect(deployment.frontend.name).toBe("projektor-frontend");
		expect(deployment.api.origin).toBe("https://projektor-api.totto2727.dev");
		expect(deployment.frontend.hostname).toBe("projektor.totto2727.dev");
		expect(deployment.api.main).toBe("./apps/api/src/index.ts");
		expect(deployment.api.compatibility).toEqual({
			date: "2024-09-23",
			flags: ["nodejs_compat", "global_fetch_strictly_public", "cache_option_enabled"],
		});
		expect(deployment.api.crons).toEqual(["0 3 * * *"]);
	});

	it("uses exact external storage bindings without declaring a storage lifecycle", () => {
		expect(existingStorageBindings()).toEqual([
			{ type: "d1", name: "DB", databaseId: "e852f9c2-e817-409e-bbf0-3168e82a1afc" },
			{ type: "kv_namespace", name: "KV", namespaceId: "b5598fbbbc2e48e3beab8bf9aecfc4bd" },
			{ type: "kv_namespace", name: "OAUTH_KV", namespaceId: "b187546f271142419343787032f6ca9b" },
			{ type: "r2_bucket", name: "R2", bucketName: "projektor-files" },
		]);
		const bindings = existingStorageBindings();
		bindings.pop();
		expect(existingStorageBindings()).toHaveLength(4);
	});

	it("retains the existing Access audience and does not enable production bypasses", () => {
		const vars = apiVariables(false, "untrusted-dev@example.com");
		expect(vars).toMatchObject({
			ENVIRONMENT: "production",
			CF_ACCESS_TEAM_DOMAIN: "totto2727.cloudflareaccess.com",
			CF_ACCESS_AUDIENCE: "327e65a1c53f85fa45155ffe4b7e1e8c35740cce3efc70b1f161392f5144ddb9",
			ADMIN_EMAILS: "kaihatu.totto2727@gmail.com",
			AUTO_JOIN_ROLE: "none",
		});
		for (const name of [
			"DEV_USER_EMAIL",
			"BOOTSTRAP_SECRET",
			"PUBLIC_READ_ONLY",
			"WORKSPACE_SUBDOMAIN_ROUTING",
			"JWT_SECRET",
		]) {
			expect(vars).not.toHaveProperty(name);
		}
		expect(deployment.access.domain).toBe(deployment.frontend.hostname);
	});

	it("provides the identity bypass only for explicitly local development", () => {
		expect(apiVariables(true)).toMatchObject({
			ENVIRONMENT: "development",
			DEV_USER_EMAIL: localDevelopment.userEmail,
			ADMIN_EMAILS: localDevelopment.userEmail,
		});
		expect(apiVariables(true, "local@example.com")).toMatchObject({
			DEV_USER_EMAIL: "local@example.com",
		});
	});

	it("requires an explicit existing production JWT secret and never defaults it", async () => {
		const missing = await Effect.runPromiseExit(configured(jwtSecret(false), {}));
		expect(Exit.isFailure(missing)).toBe(true);
		const empty = await Effect.runPromiseExit(configured(jwtSecret(false), { JWT_SECRET: "   " }));
		expect(Exit.isFailure(empty)).toBe(true);
		const preserved = await Effect.runPromise(
			configured(jwtSecret(false), { JWT_SECRET: "test-existing-production-value" }),
		);
		expect(Redacted.value(preserved)).toBe("test-existing-production-value");
		expect(JSON.stringify(preserved)).not.toContain("test-existing-production-value");
	});

	it("uses the known development secret only locally, without production configuration", async () => {
		const secret = await Effect.runPromise(configured(jwtSecret(true), {}));
		expect(Redacted.value(secret)).toBe(localDevelopment.jwtSecret);
	});

	it("fails closed unless the existing hostname-wide Access application is confirmed", async () => {
		expect(() => requireExistingAccess("true")).not.toThrow();
		for (const value of ["", "false", "yes", "TRUE"]) {
			expect(() => requireExistingAccess(value)).toThrow("PROJEKTOR_ACCESS_CONFIRMED=true");
		}
		const missing = await Effect.runPromiseExit(
			configured(productionAccessPrerequisite(false), {}),
		);
		expect(Exit.isFailure(missing)).toBe(true);
		await Effect.runPromise(
			configured(productionAccessPrerequisite(false), { PROJEKTOR_ACCESS_CONFIRMED: "true" }),
		);
		await Effect.runPromise(configured(productionAccessPrerequisite(true), {}));
	});
});
