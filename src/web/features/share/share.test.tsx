import { Effect } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { RequestApi } from "../../server/api-client";
import { ApiError } from "../../server/errors";
import { jsonResponse, testRequestApi } from "../wiki/test-api";
import { DEFAULT_BRAND, layerBrand } from "./brand";
import { renderShare as renderShareEffect } from "./server";

const renderShare = (...args: Parameters<typeof renderShareEffect>) =>
	Effect.runPromise(renderShareEffect(...args));

const workspaceBrand = {
	displayName: "Acme",
	accent: "#123456",
	onAccent: "#ffffff",
	fontFamily: "serif",
	fontUrl: "https://example.com/fonts.css",
	logoUrl: "https://example.com/logo.svg",
};
const issue = {
	title: "Public issue",
	body: "## Details\n\nComplete **SSR body**.\n\n<script>evil()</script>\n\n```mermaid\ngraph TD; A-->B\n```",
	priority: "high",
	status_name: "In progress",
	status_category: "started",
	project_key: "DEMO",
	project_name: "Demo",
	assignee_name: "Alice",
	created_at: 1700000000,
	expires_at: 1700300000,
	customFields: [{ key: "env", label: "Environment", type: "text", value: "Production" }],
	brand: workspaceBrand,
};
function apiWith(execute: RequestApi["execute"]): RequestApi {
	return testRequestApi(execute);
}
describe("public Share SSR", () => {
	it("loads only public token and deployment config with meaningful sanitized original body", async () => {
		const calls: string[] = [];
		const api = apiWith((outgoing) => {
			calls.push(outgoing.url);
			return jsonResponse(outgoing, outgoing.url.startsWith("/api/share/") ? issue : DEFAULT_BRAND);
		});
		const html = renderToStaticMarkup(
			await renderShare(api, null, new URL("https://app.test/share/view?token=public-token")),
		);
		expect(calls).toEqual(["/api/share/public-token", "/api/config/brand"]);
		expect(html).toContain("Complete <strong>SSR body</strong>.");
		expect(html).toContain("Environment");
		expect(html).toContain("Production");
		expect(html).toContain("Shared Issue - Acme");
		expect(html).toContain("--accent:#123456");
		expect(html).toContain("fonts.css");
		expect(html).toContain('class="mermaid"');
		expect(html).not.toContain("evil()");
	});
	it("does not bootstrap a missing token and renders expired/not-found links", async () => {
		const get = vi.fn();
		const missing = renderToStaticMarkup(
			await renderShare(apiWith(get), null, new URL("https://app.test/share/view")),
		);
		expect(get).not.toHaveBeenCalled();
		expect(missing).toContain("Link not found or expired");
		const expired = renderToStaticMarkup(
			await renderShare(
				apiWith((outgoing) =>
					outgoing.url.startsWith("/api/share/")
						? Effect.fail(new ApiError("http", 410, "Expired"))
						: jsonResponse(outgoing, DEFAULT_BRAND),
				),
				null,
				new URL("https://app.test/share/token"),
				{ token: "token" },
			),
		);
		expect(expired).toContain("Link not found or expired");
	});
	it("preserves typed network and schema failures for the root error boundary", async () => {
		const failure = new ApiError("network", 502, "Unavailable");
		const api = apiWith((outgoing) =>
			outgoing.url.startsWith("/api/share/")
				? Effect.fail(failure)
				: jsonResponse(outgoing, DEFAULT_BRAND),
		);
		await expect(
			renderShare(api, null, new URL("https://app.test/share/token?token=ignored"), {
				token: "token",
			}),
		).rejects.toMatchObject({ kind: "network", status: 502 });
	});
	it("layers null workspace fields over deployment defaults", () => {
		expect(
			layerBrand(DEFAULT_BRAND, {
				...workspaceBrand,
				displayName: null,
				accent: null,
				logoUrl: null,
			}).name,
		).toBe("Projektor");
	});
	it("rejects malformed public DTOs with operation-owned decoding and releases scoped responses", async () => {
		const released: string[] = [];
		const acquired: string[] = [];
		const api = apiWith((outgoing) =>
			Effect.acquireRelease(
				Effect.sync(() => acquired.push(outgoing.url)).pipe(
					Effect.andThen(
						jsonResponse(
							outgoing,
							outgoing.url.startsWith("/api/share/") ? { ...issue, title: 123 } : DEFAULT_BRAND,
						),
					),
				),
				() =>
					Effect.sync(() => {
						released.push(outgoing.url);
					}),
			),
		);
		await expect(
			renderShare(api, null, new URL("https://app.test/share/token"), { token: "token" }),
		).rejects.toMatchObject({ kind: "schema", status: 502 });
		expect(acquired).toContain("/api/share/token");
		expect(released.toSorted()).toEqual(acquired.toSorted());
	});
});
