import { localState, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import Frontend, { Api, ApiDeploymentPreflight } from "./alchemy";

export default Stack(
	"projektor",
	{ state: localState(), providers: Cloudflare.providers() },
	Effect.gen(function* () {
		yield* ApiDeploymentPreflight;
		const api = yield* Api;
		const frontend = yield* Frontend;
		return { api: api.url, frontend: frontend.url };
	}),
);
