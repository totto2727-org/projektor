import { WorkerEnvironment } from "alchemy/Cloudflare/Workers";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it, vi } from "vite-plus/test";
import { HttpClientLive } from "./http-client-layer";

// This test exercises Alchemy's public native-fetcher adapter, not an application HTTP facade.
describe("API Worker service-binding transport", () => {
	it("uses the native API binding and preserves the caller's scoped identity", async () => {
		const bindingFetch = vi.fn(async (request: Request) => {
			expect(request.url).toBe("http://localhost/api/issues");
			expect(request.headers.get("authorization")).toBe("Bearer caller");
			expect(request.headers.get("x-workspace-slug")).toBe("selected");
			return Response.json({ source: "api-worker" });
		});
		const externalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("No external fetch"));
		try {
			const body = await Effect.runPromise(
				HttpClient.execute(
					HttpClientRequest.get("https://projektor-api.totto2727.dev/api/issues").pipe(
						HttpClientRequest.setHeaders({
							authorization: "Bearer caller",
							"x-workspace-slug": "selected",
						}),
					),
				).pipe(
					Effect.flatMap(
						HttpClientResponse.schemaBodyJson(Schema.Struct({ source: Schema.String })),
					),
					Effect.scoped,
					Effect.provide(HttpClientLive),
					Effect.provideService(WorkerEnvironment, { API: { fetch: bindingFetch } }),
				),
			);
			expect(body).toEqual({ source: "api-worker" });
			expect(bindingFetch).toHaveBeenCalledTimes(1);
			expect(externalFetch).not.toHaveBeenCalled();
		} finally {
			externalFetch.mockRestore();
		}
	});
});
