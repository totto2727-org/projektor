import { ALCHEMY_DEV, ALCHEMY_PHASE, RemovalPolicy } from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { WorkerBindingProps } from "alchemy/Cloudflare/Workers";
import { Config, Effect } from "effect";
import {
	apiVariables,
	deployment,
	existingStorageBindings,
	jwtSecret,
	localDevelopment,
	productionAccessPrerequisite,
	requireProductionAccount,
} from "./config";

/** Stack-only preflight, before either production Worker is registered. */
export const ApiDeploymentPreflight = Effect.gen(function* () {
	const local = yield* ALCHEMY_DEV;
	if (!local) {
		const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
		requireProductionAccount(accountId);
	}
	yield* productionAccessPrerequisite(local);
	yield* jwtSecret(local);
});

/** One native dev database declaration shared by the API and Frontend. */
export const LocalDatabase = Cloudflare.D1.Database("LocalDatabase", {
	name: "projektor-local",
	migrations: "./packages/db/migrations",
});

const identity = {
	name: deployment.api.name,
	main: deployment.api.main,
	compatibility: deployment.api.compatibility,
	workersDev: { enabled: false, previewsEnabled: false },
	domain: { name: deployment.api.hostname, previews: false },
	crons: deployment.api.crons,
};

/** Native async Hono/OAuth Worker, composed with Frontend by the root stack. */
export const Api = Cloudflare.Worker(
	"Api",
	Effect.gen(function* () {
		// beta.79 evaluates Effect props both during registration and onCreate,
		// including when Frontend's runtime resolves env.API. Runtime needs only
		// this symbolic Worker identity, never deployment inputs or child resources.
		if ((yield* ALCHEMY_PHASE) === "runtime") return identity;

		const local = yield* ALCHEMY_DEV;
		const secret = yield* jwtSecret(local);
		const devUserEmail = local
			? yield* Config.String("DEV_USER_EMAIL").pipe(
					Config.withDefault(localDevelopment.userEmail),
					Effect.orDie,
				)
			: localDevelopment.userEmail;

		// Only alchemy dev declares storage resources. Native local providers
		// emulate these and apply schema migrations locally. Production has no
		// storage lifecycle, import, migration, creation, adoption, or deletion.
		const localStorage: WorkerBindingProps = local
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
			...identity,
			env: {
				...apiVariables(local, devUserEmail),
				...localStorage,
				JWT_SECRET: secret,
				// Match the live binding name AND class exactly. beta.79 observes
				// adoption and computes migrations. Never replay old DO migrations
				// or bind the currently unbound WorkspaceHub.
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
	Effect.tap((api) =>
		Effect.gen(function* () {
			if ((yield* ALCHEMY_PHASE) === "runtime") return;
			if (!(yield* ALCHEMY_DEV)) {
				// Public Resource.bind grants access to existing IDs, not ownership.
				yield* api.bind("external-storage", { bindings: existingStorageBindings() });
			}
		}),
	),
);
