import { ALCHEMY_DEV, localState, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import Frontend, { Api, existingStorageBindings } from "./alchemy";

export const workers = Effect.gen(function* () {
	const api = yield* Api;
	const frontend = yield* Frontend;
	if (!(yield* ALCHEMY_DEV)) {
		yield* api.bind("external-storage", { bindings: existingStorageBindings() });
		if (!api.Props.env || !("JWT_SECRET" in api.Props.env)) {
			yield* api.bind("existing-jwt-secret", {
				bindings: [{ type: "inherit", name: "JWT_SECRET" }],
			});
		}
	}
	return { api, frontend };
});

export default Stack(
	"projektor",
	{ state: localState(), providers: Cloudflare.providers() },
	workers.pipe(Effect.map(({ api, frontend }) => ({ api: api.url, frontend: frontend.url }))),
);
