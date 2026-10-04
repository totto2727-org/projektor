import { Effect } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestApi } from "../../server/api-client";
import type { RequestScope } from "../../server/request-context";
import { jsonResponse, testRequestApi } from "../wiki/test-api";
import {
	renderFeedbackDetail as renderFeedbackDetailEffect,
	renderFeedback as renderFeedbackEffect,
} from "./server";

const renderFeedback = (...args: Parameters<typeof renderFeedbackEffect>) =>
	Effect.runPromise(renderFeedbackEffect(...args));
const renderFeedbackDetail = (...args: Parameters<typeof renderFeedbackDetailEffect>) =>
	Effect.runPromise(renderFeedbackDetailEffect(...args));

vi.mock("./actions", () => ({}));
vi.mock("@effront/core/query", () => ({
	query: () => {
		throw new Error("No client bootstrap during SSR");
	},
}));

const workspace = { id: "workspace", name: "Team", slug: "team", role: "member" as const };
const project = {
	id: "actual",
	key: "ACT",
	name: "Actual",
	slug: null,
	description: null,
	workspace_id: "workspace",
	workspace_name: "Team",
	workspace_slug: "team",
	open_issue_count: 0,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 1,
	updated_at: 1,
};
const scope: RequestScope = {
	user: { id: "user", name: "Alice", email: "alice@example.test" },
	workspaces: [workspace],
	projects: [project],
	selection: { kind: "workspace", workspace },
};
const source = {
	id: "source",
	name: "Customer feedback",
	description: "Tell us",
	isActive: true,
	allowedOrigins: ["https://example.test"],
	tokenPreview: "pk_...",
	createdAt: 1,
	revokedAt: null,
};
const row = {
	id: "row",
	sourceId: "source",
	sourceName: "Customer feedback",
	rating: 5,
	ratingScale: "five_star",
	body: "Useful customer comment",
	submitterLabel: "Customer",
	sourceUrl: "https://example.test/path?screen=home",
	appVersion: "v1",
	status: "new",
	linkedIssueId: null,
	createdAt: 1,
};
const summary = {
	sourceId: "source",
	sourceName: "Customer feedback",
	totalCount: 1,
	versions: [
		{
			appVersion: "v1",
			totalCount: 1,
			withCommentCount: 1,
			thumbsUpPct: null,
			avgFiveStar: 5,
			lastSeenAt: 1,
		},
	],
};
function apiWith(execute: RequestApi["execute"]): RequestApi {
	return testRequestApi(execute);
}
describe("original Feedback SSR", () => {
	it("requires project for the grid but not a project URL for details", async () => {
		const get = vi.fn();
		expect(
			renderToStaticMarkup(
				await renderFeedback(apiWith(get), scope, new URL("https://app.test/feedback"))
			)
		).toContain("Choose a project");
		expect(get).not.toHaveBeenCalled();
	});
	it("derives detail project from authorized source lookup rather than URL hints", async () => {
		const calls: string[] = [];
		const api = apiWith((outgoing) => {
			const path = outgoing.url;
			calls.push(path);
			expect(outgoing.headers["x-workspace-slug"]).toBe("team");
			return jsonResponse(
				outgoing,
				path.startsWith("/api/feedback-sources/")
					? { projectId: "actual" }
					: path.endsWith("/feedback-sources")
						? [source]
						: path.includes("/summary")
							? [summary]
							: [row]
			);
		});
		const html = renderToStaticMarkup(
			await renderFeedbackDetail(
				api,
				scope,
				new URL("https://app.test/feedback/view?sourceId=source&projectId=wrong")
			)
		);
		expect(calls.every((path) => !path.includes("wrong"))).toBe(true);
		expect(html).toContain("Useful customer comment");
		expect(html).toContain("Context (1)");
		expect(html).toContain("Summary");
		expect(html).toContain("Settings");
		expect(html).toContain("Mark reviewed");
	});
	it("does not read project data when entity lookup returns an unauthorized project", async () => {
		const calls: string[] = [];
		const api = apiWith((outgoing) => {
			calls.push(outgoing.url);
			return jsonResponse(outgoing, { projectId: "outside" });
		});
		expect(
			renderToStaticMarkup(
				await renderFeedbackDetail(api, scope, new URL("https://app.test/feedback/source"), {
					sourceId: "source",
				})
			)
		).toContain("Feedback source not found");
		expect(calls).toEqual(["/api/feedback-sources/source"]);
	});
	it("renders source cards and summary version statistics from initial server DTOs", async () => {
		const api = apiWith((outgoing) =>
			jsonResponse(outgoing, outgoing.url.endsWith("/feedback-sources") ? [source] : [summary])
		);
		const html = renderToStaticMarkup(
			await renderFeedback(
				api,
				{ ...scope, selection: { kind: "project", workspace, project } },
				new URL("https://app.test/feedback")
			)
		);
		expect(html).toContain("Customer feedback");
		expect(html).toContain("1 total");
		expect(html).toContain("workspace=team");
	});
});
