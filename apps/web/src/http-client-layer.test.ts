import { fromCloudflareFetcher, toHttpClient } from "alchemy/Cloudflare";
import { WorkerEnvironment } from "alchemy/Cloudflare/Workers";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it, vi } from "vite-plus/test";
import { HttpClientLive, serviceBindingHttpClient } from "./http-client-layer";
import { forwardApi } from "./gateway";

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

type Binding = Parameters<typeof serviceBindingHttpClient>[0];

describe("native binding HTTP boundary", () => {
	it("preserves the login 302 for the gateway instead of fetching its frontend-only target", async () => {
		const destination = "/wiki/view/page-1?workspace=alpha&projectId=p1";
		const requestedPaths: string[] = [];
		const bindingFetch = vi.fn(async (request: Request, options?: RequestInit) => {
			expect(options?.signal).toBeInstanceOf(AbortSignal);
			requestedPaths.push(new URL(request.url).pathname);
			// Model the native binding's follow default: the API does not own frontend routes.
			if (request.redirect !== "manual") {
				requestedPaths.push(new URL(destination, request.url).pathname);
				return new Response("API route not found", { status: 404 });
			}
			return new Response(null, { status: 302, headers: { location: destination } });
		});
		const externalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("No external fetch"));
		try {
			const result = await Effect.runPromise(
				forwardApi(
					new Request(
						`https://front.example/auth/login?${new URLSearchParams({ redirect_url: destination })}`,
						{
							headers: { cookie: "CF_Authorization=actual-user; unrelated=private" },
						},
					),
					{ API_BASE: "https://api.example" },
				).pipe(
					Effect.scoped,
					Effect.provide(HttpClientLive),
					Effect.provideService(WorkerEnvironment, { API: { fetch: bindingFetch } }),
				),
			);
			expect(result.status).toBe(302);
			expect(result.headers.location).toBe(destination);
			expect(result.headers["cache-control"]).toBe("private, no-store");
			expect(requestedPaths).toEqual(["/auth/login"]);
			expect(bindingFetch).toHaveBeenCalledOnce();
			const sent = bindingFetch.mock.calls[0]![0];
			expect(sent.redirect).toBe("manual");
			expect(sent.headers.get("cookie")).toBe("CF_Authorization=actual-user");
			expect(externalFetch).not.toHaveBeenCalled();
		} finally {
			externalFetch.mockRestore();
		}
	});
	it("reproduces the pinned upstream FormData conversion losing the boundary header", async () => {
		let observed: Request | undefined;
		const client = toHttpClient(
			fromCloudflareFetcher({
				async fetch(request: Request) {
					observed = request;
					try {
						await request.formData();
						return Response.json({});
					} catch {
						return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
					}
				},
			} as Binding),
		);
		const fields = new FormData();
		fields.set("file", new File(["small file"], "small.txt"));
		fields.set("entityType", "wiki_page");
		fields.set("entityId", "wiki-1");
		const response = await Effect.runPromise(
			Effect.scoped(
				client
					.execute(
						HttpClientRequest.post("https://api.example/api/files").pipe(
							HttpClientRequest.bodyFormData(fields),
						),
					)
					.pipe(
						Effect.flatMap((response) =>
							Effect.map(response.json, (body) => ({
								status: response.status,
								body,
							})),
						),
					),
			),
		);
		expect(observed?.headers.get("content-type")).toBeNull();
		expect(response).toEqual({ status: 400, body: { error: "Expected multipart/form-data" } });
	});

	it.each(["GET", "POST"] as const)("preserves non-multipart %s requests", async (method) => {
		const client = serviceBindingHttpClient({
			async fetch(request: Request) {
				expect(request.method).toBe(method);
				expect(request.headers.get("x-workspace-slug")).toBe("alpha");
				if (method === "POST") {
					expect(request.headers.get("content-type")).toBe("application/json");
					expect(await request.json()).toEqual({ title: "Unchanged mutation" });
				} else {
					expect(request.body).toBeNull();
					expect(request.headers.get("content-type")).toBeNull();
				}
				return Response.json({ ok: true });
			},
		} as Binding);
		const request = HttpClientRequest.make(method)("https://api.example/api/issues").pipe(
			HttpClientRequest.setHeader("x-workspace-slug", "alpha"),
		);
		await expect(
			Effect.runPromise(
				Effect.scoped(
					client
						.execute(
							method === "POST"
								? HttpClientRequest.bodyJsonUnsafe(request, { title: "Unchanged mutation" })
								: request,
						)
						.pipe(Effect.flatMap((response) => response.json)),
				),
			),
		).resolves.toEqual({ ok: true });
	});
});
