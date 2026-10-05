import { ALCHEMY_DEV, localState, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import Frontend from "./apps/web/src/entry.workers";
import { Api, ApiDeploymentPreflight } from "./infra/api";
import { existingStorageBindings } from "./infra/config";

export default Stack(
	"projektor",
	{ state: localState(), providers: Cloudflare.providers() },
	Effect.gen(function* () {
		// Guard the resolved deployment account and existing protection/secret
		// before any production Worker registration. Never runs in a Worker graph.
		yield* ApiDeploymentPreflight;
		const api = yield* Api;
		const frontend = yield* Frontend;
		if (!(yield* ALCHEMY_DEV)) {
			yield* frontend.bind("external-database", {
				bindings: existingStorageBindings().filter((binding) => binding.type === "d1"),
			});
		}
		return { api: api.url, frontend: frontend.url };
	}),
);
