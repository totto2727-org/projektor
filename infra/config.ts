import { Config, Effect, Redacted } from "effect";
import type { WorkerBinding } from "alchemy/Cloudflare/Workers";

/** Existing production identities, not a template for provisioning replacements. */
export const deployment = {
	accountId: "5643a837ef66765e7881c0831a36ebed",
	api: {
		name: "projektor",
		hostname: "projektor-api.totto2727.dev",
		origin: "https://projektor-api.totto2727.dev",
		main: "./apps/api/src/index.ts",
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
		// The existing hostname-wide application/policies remain operator-managed.
		// beta.79's Worker access prop enrolls/converges an application. It is not
		// a read-only import, and must not be used to recreate this application.
		domain: "projektor.totto2727.dev",
	},
};

export function requireProductionAccount(accountId: string) {
	if (accountId !== deployment.accountId) {
		throw new Error(
			"Resolved Cloudflare account does not match the preserved Projektor production account",
		);
	}
}

/** Public Worker.bind wire bindings. These declare no storage lifecycle at all. */
export function existingStorageBindings(): WorkerBinding[] {
	return [
		{ type: "d1", name: "DB", databaseId: deployment.storage.database.id },
		{ type: "kv_namespace", name: "KV", namespaceId: deployment.storage.cache.id },
		{ type: "kv_namespace", name: "OAUTH_KV", namespaceId: deployment.storage.oauth.id },
		{ type: "r2_bucket", name: "R2", bucketName: deployment.storage.files.name },
	];
}

export const localDevelopment = {
	userEmail: "dev@projektor.local",
	// Deliberately known, local-only. Never generate or default a production secret.
	jwtSecret: "projektor-local-development-only-secret",
};

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

/** Reads the SAME existing production value. Omitted secrets are not preserved by beta.79. */
export function jwtSecret(local: boolean) {
	return local
		? Effect.succeed(Redacted.make(localDevelopment.jwtSecret))
		: Config.Redacted("JWT_SECRET").pipe(
				Effect.flatMap((secret) =>
					Redacted.value(secret).trim().length > 0
						? Effect.succeed(secret)
						: Effect.die(new Error("JWT_SECRET must contain the existing production secret")),
				),
				Effect.orDie,
			);
}

/** Confirmation is not a remote protection check and does not change Access policies. */
export function requireExistingAccess(confirmed: string) {
	if (confirmed !== "true") {
		throw new Error(
			"Confirm the existing hostname-wide Cloudflare Access protection for projektor.totto2727.dev, then set PROJEKTOR_ACCESS_CONFIRMED=true. Existing policies must not be recreated.",
		);
	}
}

export function productionAccessPrerequisite(local: boolean) {
	return local
		? Effect.void
		: Config.String("PROJEKTOR_ACCESS_CONFIRMED").pipe(
				Config.withDefault("false"),
				Effect.flatMap((confirmed) => Effect.sync(() => requireExistingAccess(confirmed))),
				Effect.orDie,
			);
}
