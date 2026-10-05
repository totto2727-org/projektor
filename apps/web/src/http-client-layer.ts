import { fromCloudflareFetcher, toHttpClient } from "alchemy/Cloudflare";
import { WorkerEnvironment } from "alchemy/Cloudflare/Workers";
import { Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";

/** The native service binding keeps all API calls inside the server-side Worker graph. */
export const HttpClientLive = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		const env = yield* WorkerEnvironment;
		return toHttpClient(
			fromCloudflareFetcher(env.API as Parameters<typeof fromCloudflareFetcher>[0]),
		);
	}),
);
