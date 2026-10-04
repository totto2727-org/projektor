/**
 * PROJ-313: API-driven E2E for the group-access feature (PROJ-311).
 *
 * These tests exercise the groups REST surface directly via Playwright's
 * `request` fixture rather than the browser, with explicit workspace headers
 * for the ephemeral E2E workspace created in globalSetup. Only the
 * render-smoke test below uses `page`, selecting that workspace via the URL.
 *
 * Prerequisites: globalSetup must have written e2e/.e2e-ctx.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import type { E2EContext } from "./global-setup";

function readCtx(): E2EContext {
	const file = path.resolve(process.cwd(), "e2e", ".e2e-ctx.json");
	if (!fs.existsSync(file)) {
		throw new Error(
			"e2e/.e2e-ctx.json not found — did globalSetup succeed?\n" +
				"Run with E2E_BASE_URL set to a dev deployment."
		);
	}
	return JSON.parse(fs.readFileSync(file, "utf-8")) as E2EContext;
}

interface GroupDetail {
	id: string;
	name: string;
	members: Array<{ userId: string; email: string; name: string }>;
	grants: Array<{ projectId: string; projectName: string; projectKey: string; role: string }>;
}

test.describe("Groups flow (admin)", () => {
	test("admin sees the seeded group with its grant and member", async ({ request }) => {
		test.skip(!process.env.E2E_BASE_URL, "E2E_BASE_URL not set — skipping live deployment test");

		const ctx = readCtx();

		const res = await request.get(`/api/workspaces/${ctx.workspaceSlug}/groups/${ctx.groupId}`, {
			headers: { "X-Workspace-Slug": ctx.workspaceSlug },
		});
		expect(res.ok()).toBe(true);
		const detail = (await res.json()) as GroupDetail;

		expect(detail.id).toBe(ctx.groupId);
		expect(detail.name).toBe(ctx.groupName);

		const grant = detail.grants.find((g) => g.projectId === ctx.grantedProjectId);
		expect(grant).toBeTruthy();
		expect(grant?.role).toBe("member");
		expect(detail.grants.some((g) => g.projectId === ctx.ungrantedProjectId)).toBe(false);

		expect(detail.members.some((m) => m.userId === ctx.memberUserId)).toBe(true);
	});

	test("admin can create a new group, grant a project, and read it back", async ({ request }) => {
		test.skip(!process.env.E2E_BASE_URL, "E2E_BASE_URL not set — skipping live deployment test");

		const ctx = readCtx();
		const groupName = `E2E Ad-hoc Group ${Date.now()}`;

		const createRes = await request.post(`/api/workspaces/${ctx.workspaceSlug}/groups`, {
			headers: { "X-Workspace-Slug": ctx.workspaceSlug },
			data: { name: groupName },
		});
		expect(createRes.status()).toBe(201);
		const created = (await createRes.json()) as { id: string; name: string };
		expect(created.name).toBe(groupName);

		const grantRes = await request.put(
			`/api/workspaces/${ctx.workspaceSlug}/groups/${created.id}/grants`,
			{
				headers: { "X-Workspace-Slug": ctx.workspaceSlug },
				data: { projectId: ctx.grantedProjectId, role: "viewer" },
			}
		);
		expect(grantRes.ok()).toBe(true);

		const detailRes = await request.get(
			`/api/workspaces/${ctx.workspaceSlug}/groups/${created.id}`,
			{ headers: { "X-Workspace-Slug": ctx.workspaceSlug } }
		);
		expect(detailRes.ok()).toBe(true);
		const detail = (await detailRes.json()) as GroupDetail;

		const grant = detail.grants.find((g) => g.projectId === ctx.grantedProjectId);
		expect(grant).toBeTruthy();
		expect(grant?.role).toBe("viewer");
	});

	test("groups settings page renders the group manager UI", async ({ page }) => {
		test.skip(!process.env.E2E_BASE_URL, "E2E_BASE_URL not set — skipping live deployment test");

		const ctx = readCtx();
		await page.goto(`/settings/groups?workspace=${encodeURIComponent(ctx.workspaceSlug)}`);
		await expect(page.getByRole("heading", { name: "Groups" })).toBeVisible({ timeout: 15_000 });
	});
});
