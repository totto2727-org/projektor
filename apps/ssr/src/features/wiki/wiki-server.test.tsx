import { Effect } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestApi } from "../../server/api-client";
import { ApiError } from "../../server/errors";
import type { RequestScope } from "../../server/request-context";
import { renderWiki } from "./server";
import { jsonResponse, testRequestApi } from "./test-api";
import type { WikiSeed } from "./WikiPageClient";

vi.mock("./actions", () => ({}));
vi.mock("../../attachment-actions", () => ({
	uploadAttachment: () => {},
	uploadInlineImage: () => {},
}));
vi.mock("@effront/core/query", () => ({
	query: () => {
		throw new Error("No client bootstrap during SSR");
	},
}));

const workspace = { id: "workspace", name: "Team", slug: "team", role: "member" as const };
const scope: RequestScope = {
	user: { id: "user", name: "Alice", email: "alice@example.test" },
	workspaces: [workspace],
	projects: [],
	selection: { kind: "workspace", workspace },
};
const page = {
	id: "page",
	slug: "guide",
	title: "Guide",
	content: "## Initial body\n\nLoaded on the **server**.",
	project_id: null,
	parent_id: null,
	revisionId: "rev",
	updated_at: 1,
	type: null,
	status: null,
	tags: [],
	owners: [],
	verified_at: null,
	verified_by: null,
	verify_interval: null,
	freshness: null,
};
function fixture(
	calls: string[],
	options: { draftFailure?: boolean; projectId?: string } = {}
): RequestApi {
	return testRequestApi((outgoing) =>
		Effect.suspend(() => {
			const path = outgoing.url;
			calls.push(path);
			if (!path.includes("/config/brand"))
				expect(outgoing.headers["x-workspace-slug"]).toBe("team");
			if (options.draftFailure && path.endsWith("/draft"))
				return Effect.fail(new ApiError("network", 502, "Draft unavailable"));
			const data =
				path === "/api/wiki/guide"
					? { ...page, project_id: options.projectId ?? null }
					: path === "/api/config/brand"
						? { name: "Base", mark: "B", accent: null, onAccent: null, logoUrl: null }
						: path.includes("/brand")
							? { displayName: "Acme", accent: null, onAccent: null, logoUrl: null }
							: path.endsWith("/draft")
								? null
								: path.startsWith("/api/wiki/tree")
									? [{ id: "page", slug: "guide", title: "Guide", type: null, children: [] }]
									: [];
			return jsonResponse(outgoing, data);
		})
	);
}
describe("Wiki request-owned Effects", () => {
	it("is lazy and renders workspace-wide Wiki data and brand without requiring a project", async () => {
		const calls: string[] = [];
		const effect = renderWiki(
			fixture(calls),
			scope,
			new URL("https://app.test/wiki/guide?workspace=team&slug=untrusted-hint"),
			{ slug: "guide" }
		);
		expect(calls).toHaveLength(0);
		const html = renderToStaticMarkup(await Effect.runPromise(effect));
		expect(html).toContain("Loaded on the <strong>server</strong>.");
		expect(html).toContain("Guide - Acme Wiki");
		expect(calls).toContain("/api/wiki/tree?");
		expect(calls.every((path) => !path.includes("projectId="))).toBe(true);
	});
	it("disables autosave if an optional existing-draft read fails", async () => {
		const rendered = await Effect.runPromise(
			renderWiki(
				fixture([], { draftFailure: true }),
				scope,
				new URL("https://app.test/wiki/guide/edit"),
				{ slug: "guide" }
			)
		);
		const { initial } = rendered.props as { initial: WikiSeed };
		expect(initial.draftStatus).toBe("failed");
		expect(initial.page?.content).toContain("server");
	});
	it("rejects a project page outside the authorized catalog before loading lookup data", async () => {
		const calls: string[] = [];
		await expect(
			Effect.runPromise(
				renderWiki(
					fixture(calls, { projectId: "outside" }),
					scope,
					new URL("https://app.test/wiki/guide"),
					{ slug: "guide" }
				)
			)
		).rejects.toMatchObject({ status: 404 });
		expect(calls).toEqual(["/api/wiki/guide"]);
	});
});
