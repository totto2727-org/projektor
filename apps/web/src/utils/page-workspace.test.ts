import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const pagesDirectory = resolve(process.cwd(), "src/pages");
const pagePaths = readdirSync(pagesDirectory, { recursive: true, encoding: "utf8" })
	.filter((path) => path.endsWith(".astro"))
	.sort();
const issuePage = readFileSync(resolve(pagesDirectory, "issues/view.astro"), "utf8");
const inlinePrefetch = issuePage.match(/<script[^>]*is:inline[^>]*>([\s\S]*?)<\/script>/)?.[1];

function runPrefetch(path: string) {
	if (!inlinePrefetch) throw new Error("Issue page has no inline prefetch script");
	const location = new URL(path, "https://same-host.example");
	const window: Record<string, unknown> = {};
	const fetch = vi.fn().mockResolvedValue(null);
	// Execute the actual page script, not a copied implementation.
	new Function("window", "document", "location", "fetch", inlinePrefetch)(
		window,
		{ addEventListener: vi.fn() },
		location,
		fetch
	);
	return { window, fetch };
}

describe("workspace-neutral Astro pages", () => {
	it.each(pagePaths)("%s does not inject a build-time workspace", (path) => {
		const source = readFileSync(resolve(pagesDirectory, path), "utf8");
		expect(source).not.toContain("PUBLIC_WORKSPACE_SLUG");
		expect(source).not.toMatch(/workspaceSlug=\{/);
	});

	it("does not configure a fixed browser tenant in Playwright or the web env example", () => {
		const config = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
		const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
		expect(config).not.toContain("PUBLIC_WORKSPACE_SLUG");
		expect(config).not.toContain("X-Workspace-Slug");
		expect(envExample).not.toContain("PUBLIC_WORKSPACE_SLUG");
	});

	it("does not prefetch until a runtime URL specifies workspace scope", () => {
		const { fetch, window } = runPrefetch("/issues/view?id=issue-1");
		expect(fetch).not.toHaveBeenCalled();
		expect(window).not.toHaveProperty("__projektorIssuePrefetch");
	});

	it.each(["alpha", "beta"])(
		"prefetches the URL-selected %s workspace on the same host",
		(slug) => {
			const { fetch, window } = runPrefetch(`/issues/view?id=issue-1&workspace=${slug}`);
			expect(fetch).toHaveBeenCalledWith("/api/issues/issue-1", {
				credentials: "include",
				headers: { "X-Workspace-Slug": slug },
			});
			expect(window.__projektorIssuePrefetch).toMatchObject({
				key: "issue-1",
				workspaceSlug: slug,
			});
		}
	);
});
