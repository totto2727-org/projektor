import * as NodeServices from "@effect/platform-node/NodeServices";
import * as RuntimeServices from "@alchemy.run/cloudflare-runtime/core/RuntimeServices";
import * as Credentials from "@distilled.cloud/cloudflare/Credentials";
import { Effect, Exit, Layer, Scope } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import type { Plugin } from "vite-plus";
import { makeInlineApiLayer } from "./inline-api";

/** Only preview allocates runtime services. A build must remain offline and exit. */
export async function makePreviewContext(isPreview: boolean | undefined) {
	if (!isPreview) return undefined;
	const directory = process.env.PROJEKTOR_E2E_STORAGE_DIRECTORY;
	if (!directory) {
		throw new Error(
			"Run previews through the E2E config so both Workers use one isolated runtime and storage directory.",
		);
	}
	const scope = Scope.makeUnsafe();
	// Use the supported public runtime factory, not private Paths/services.
	// It includes the remote-binding layer, but credentials cannot resolve and
	// the node-side client only permits loopback transport for the dev registry.
	const noCredentials = Layer.succeed(
		Credentials.Credentials,
		Effect.die(new Error("Cloudflare credentials are forbidden in the isolated E2E host.")),
	);
	const localHttp = Layer.effect(
		HttpClient.HttpClient,
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			return HttpClient.transform(http, (response, request) => {
				const url = new URL(request.url);
				return url.protocol === "http:" &&
					["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
					? response
					: Effect.die(
							new Error(`Non-loopback HTTP is forbidden in the isolated E2E host: ${url.origin}`),
						);
			});
		}),
	).pipe(Layer.provide(FetchHttpClient.layer));
	const inlineApi = await makeInlineApiLayer(directory);
	const runtime = Layer.merge(
		RuntimeServices.layerRuntime({
			api: { accountId: "local-e2e-no-remote" },
			storage: { directory },
		}),
		inlineApi,
	).pipe(
		Layer.provideMerge(NodeServices.layer),
		Layer.provide(Layer.merge(noCredentials, localHttp)),
	);
	const context = await runtime.pipe(Layer.buildWithScope(scope), Effect.runPromise);
	const lifecycle: Plugin = {
		name: "projektor-e2e-local-runtime-lifecycle",
		configurePreviewServer(server) {
			server.httpServer.once("close", () => {
				const close = Scope.closeUnsafe(scope, Exit.void);
				if (close) void Effect.runPromiseExit(close);
			});
		},
	};
	return { context, lifecycle };
}
