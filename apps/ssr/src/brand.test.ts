import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import { brandStyles, defaultBrand, loadBrand } from "./brand";
import { HttpClientLive } from "./http-client-layer";
import { createRequestApi, type RequestScope } from "./server";

function load(
	responses: Record<string, unknown>,
	calls: Array<{ path: string; workspace: string | null }>,
	scope: RequestScope | null
) {
	const transport: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		const path = new URL(request.url).pathname;
		calls.push({ path, workspace: request.headers.get("x-workspace-slug") });
		return path in responses ? Response.json(responses[path]) : new Response(null, { status: 404 });
	};
	return Effect.runPromise(
		createRequestApi(new Request("https://frontend.example/"), {
			apiBaseUrl: "https://api.example",
		}).pipe(
			Effect.flatMap((api) => loadBrand(api, scope)),
			Effect.provide(HttpClientLive),
			Effect.provideService(FetchHttpClient.Fetch, transport)
		)
	);
}
const workspace = { id: "w", slug: "beta", name: "Beta", role: "owner" as const };
const scope: RequestScope = {
	user: { id: "u", email: "u@example.test", name: "User" },
	workspaces: [workspace],
	projects: [],
	selection: { kind: "workspace", workspace },
};

describe("server-rendered brand", () => {
	it("layers only the explicitly resolved workspace over the deployment brand", async () => {
		const calls: Array<{ path: string; workspace: string | null }> = [];
		const brand = await load(
			{
				"/api/config/brand": { ...defaultBrand, name: "Deploy", accent: "#123456" },
				"/api/workspaces/beta/brand": {
					displayName: "Beta",
					accent: null,
					onAccent: "#ffffff",
					logoUrl: null,
				},
			},
			calls,
			scope
		);
		expect(brand).toMatchObject({
			name: "Beta",
			mark: "B",
			accent: "#123456",
			onAccent: "#ffffff",
		});
		expect(calls).toEqual([
			{ path: "/api/config/brand", workspace: null },
			{ path: "/api/workspaces/beta/brand", workspace: "beta" },
		]);
		expect(brandStyles(brand)).toMatchObject({
			"--light-accent": "#123456",
			"--dark-on-accent": "#ffffff",
		});
	});
	it("does not look up a tenant on a global or public page", async () => {
		const calls: Array<{ path: string; workspace: string | null }> = [];
		await load({ "/api/config/brand": defaultBrand }, calls, null);
		await load({ "/api/config/brand": defaultBrand }, calls, {
			...scope,
			selection: { kind: "global" },
		});
		expect(calls).toEqual([
			{ path: "/api/config/brand", workspace: null },
			{ path: "/api/config/brand", workspace: null },
		]);
	});
	it("keeps cosmetic failures optional without swallowing page-data errors", async () => {
		expect(await load({}, [], scope)).toEqual(defaultBrand);
	});
});
