import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type BrowserAudit = {
	pageErrors: string[];
	consoleErrors: string[];
	directApiRequests: { url: string; method: string; resourceType: string }[];
	checkpoints: {
		name: string;
		url: string;
		innerWidth: number;
		documentWidth: number;
		viewportWidth: number;
	}[];
};
const pageAudits = new WeakMap<Page, BrowserAudit>();
const testAudits = new Map<string, BrowserAudit[]>();

function observeBrowser(page: Page, testInfo: TestInfo) {
	const existing = pageAudits.get(page);
	if (existing) return existing;
	const audit: BrowserAudit = {
		pageErrors: [],
		consoleErrors: [],
		directApiRequests: [],
		checkpoints: [],
	};
	pageAudits.set(page, audit);
	const audits = testAudits.get(testInfo.testId) ?? [];
	audits.push(audit);
	testAudits.set(testInfo.testId, audits);
	page.on("pageerror", (error) => audit.pageErrors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") audit.consoleErrors.push(message.text());
	});
	page.on("request", (request) => {
		if (
			["fetch", "xhr"].includes(request.resourceType()) &&
			new URL(request.url()).pathname.startsWith("/api/")
		) {
			audit.directApiRequests.push({
				url: request.url(),
				method: request.method(),
				resourceType: request.resourceType(),
			});
		}
	});
	return audit;
}

test.beforeEach(async ({ page }, testInfo) => {
	observeBrowser(page, testInfo);
});

test.afterEach(async ({ page }, testInfo) => {
	observeBrowser(page, testInfo);
	const audits = testAudits.get(testInfo.testId) ?? [];
	const path = testInfo.outputPath("browser-audit.json");
	await writeFile(path, JSON.stringify({ project: testInfo.project.name, audits }, null, 2));
	await testInfo.attach("browser-audit", { path, contentType: "application/json" });
	testAudits.delete(testInfo.testId);
	for (const audit of audits) {
		expect(audit.pageErrors, "Browser pageerror including hydration").toEqual([]);
		expect(audit.consoleErrors, "Browser console.error including hydration").toEqual([]);
		expect(audit.directApiRequests, "Browser must not use direct /api fetch or XHR").toEqual([]);
	}
});

async function checkpoint(page: Page, testInfo: TestInfo, name: string) {
	const dimensions = await page.evaluate(() => ({
		innerWidth,
		documentWidth: document.documentElement.scrollWidth,
	}));
	const viewportWidth = page.viewportSize()?.width;
	expect(viewportWidth, "Acceptance viewport must be explicit").toBeDefined();
	if (viewportWidth === undefined) throw new Error("Acceptance viewport must be explicit.");
	observeBrowser(page, testInfo).checkpoints.push({
		name,
		url: page.url(),
		...dimensions,
		viewportWidth,
	});
	await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
	expect(dimensions.documentWidth, `${name}: document must fit viewport`).toBeLessThanOrEqual(
		dimensions.innerWidth,
	);
	expect(dimensions.innerWidth, `${name}: layout viewport must not expand`).toBeLessThanOrEqual(
		viewportWidth,
	);
	expect(
		dimensions.documentWidth,
		`${name}: document must fit configured viewport`,
	).toBeLessThanOrEqual(viewportWidth);
}

test("real API write is visible in frontend direct shared D1 read", async ({
	request,
	page,
}, testInfo) => {
	const suffix = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
	const name = `Shared D1 ${suffix}`;
	const write = await request.post("http://127.0.0.1:4392/api/projects", {
		headers: { "X-Workspace-Slug": "projektor" },
		data: { name, key: `D${suffix}` },
	});
	expect(write.status(), await write.text()).toBe(201);
	const project = await write.json();
	expect(project.id).toBeTruthy();
	const response = await page.goto("/?workspace=projektor");
	expect(response?.status()).toBe(200);
	// The application catalog loader reads the frontend DB binding directly.
	// This server-side fixture write reached the separate actual API Worker
	// service through its loopback socket, not hydrated component state. It is
	// not claimed as a native browser mutation.
	const link = page.getByRole("link").filter({ has: page.getByText(name, { exact: true }) });
	await expect(link).toHaveCount(1);
	expect(
		new URL((await link.getAttribute("href")) ?? "", page.url()).searchParams.get("projectId"),
	).toBe(project.id);
	await checkpoint(page, testInfo, "api-write-frontend-shared-db-read");
	await link.click();
	await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
	await checkpoint(page, testInfo, "shared-db-project-reload");
});

async function assertShell(page: Page) {
	await expect(page.getByRole("main")).toBeVisible();
	await expect(page.getByRole("link", { name: /skip to (main )?content/i })).toBeAttached();
	await expect(page.getByRole("button", { name: /^Account(?::|$)/ })).toBeVisible();
	const menu = page
		.locator("header.projektor-topbar")
		.getByRole("button", { name: "Toggle Sidebar", exact: true });
	if (await menu.isVisible()) {
		await menu.click();
		await expect(page.getByRole("list", { name: "Primary navigation", exact: true })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(menu).toBeFocused();
	} else {
		await expect(page.getByRole("list", { name: "Primary navigation", exact: true })).toBeVisible();
	}
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
		.toBe(true);
}

test("cold protected initial HTML is usable without JavaScript", async ({
	browser,
	baseURL,
}, testInfo) => {
	const context = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
		viewport:
			testInfo.project.name === "mobile"
				? { width: 393, height: 851 }
				: { width: 1440, height: 1000 },
	});
	try {
		const page = await context.newPage();
		observeBrowser(page, testInfo);
		const response = await page.goto("/?workspace=projektor");
		expect(response?.status()).toBe(200);
		expect(response?.headers()["cache-control"]).toMatch(/private/);
		await expect(page.getByRole("main")).toBeVisible();
		await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: /^Account(?::|$)/ })).toBeVisible();
		await expect(page.getByText(/temporarily unavailable|session has expired/i)).toHaveCount(0);
		await checkpoint(page, testInfo, "initial-no-js");
	} finally {
		await context.close();
	}
});

test("native create project and issue refresh canonical reads and navigation", async ({
	page,
	browser,
	baseURL,
}, testInfo) => {
	const suffix = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
	const projectName = `Alchemy acceptance ${suffix}`;
	const projectKey = `E${suffix}`;
	const issueTitle = `Native issue ${suffix}`;
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/?workspace=projektor");
	await assertShell(page);
	await checkpoint(page, testInfo, "initial-shell");
	// Native <details> remains operable without depending on CSS/component internals.
	await page.getByText("+ New project", { exact: true }).click();
	await page.getByRole("textbox", { name: "Name", exact: true }).fill(projectName);
	await page.getByRole("textbox", { name: "Key", exact: true }).fill(projectKey);
	await checkpoint(page, testInfo, "native-project-form");
	await page.getByRole("button", { name: "Create project", exact: true }).click();
	const projectLink = page.getByRole("link").filter({ hasText: projectName });
	await expect(projectLink).toHaveCount(1);
	await checkpoint(page, testInfo, "project-created-canonical-list");
	await projectLink.click();
	await expect(
		page.getByRole("heading", { name: projectName, exact: true, level: 1 }),
	).toBeVisible();
	await checkpoint(page, testInfo, "project-created-detail");
	await expect(page).toHaveURL((url) => url.pathname.startsWith("/projects/view/"));
	const projectUrl = page.url();
	const sections = page.getByRole("navigation", { name: "Project sections" });
	await sections.getByRole("link", { name: "Issues", exact: true }).click();
	await expect(page).toHaveURL((url) => url.pathname === "/issues");
	const issuesUrl = page.url();
	expect(new URL(issuesUrl).searchParams.get("workspace")).toBe("projektor");
	expect(new URL(issuesUrl).searchParams.get("projectId")).toBeTruthy();
	await checkpoint(page, testInfo, "project-scoped-issues");
	await page.getByRole("button", { name: /New issue/ }).click();
	const dialog = page.getByRole("dialog", { name: "Create new issue" });
	await expect(dialog).toBeVisible();
	await dialog.getByPlaceholder("Issue title").fill(issueTitle);
	await checkpoint(page, testInfo, "native-issue-form");
	await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	const issueLink = page.getByRole("link", { name: issueTitle, exact: true });
	await expect(issueLink).toBeVisible();
	await checkpoint(page, testInfo, "issue-created-canonical-list");
	const canonicalIssueUrl = new URL((await issueLink.getAttribute("href")) ?? "", page.url()).href;
	await issueLink.click();
	await expect(page.getByRole("heading", { name: issueTitle, exact: true })).toBeVisible();
	await checkpoint(page, testInfo, "issue-created-detail");
	await expect(page).toHaveURL(canonicalIssueUrl);
	const issueUrl = page.url();
	await page.reload();
	await expect(page.getByRole("heading", { name: issueTitle, exact: true })).toBeVisible();
	await checkpoint(page, testInfo, "issue");
	await page.goBack();
	await expect(page).toHaveURL(issuesUrl);
	await expect(page.getByRole("link", { name: issueTitle, exact: true })).toBeVisible();
	await checkpoint(page, testInfo, "issue-back-scoped-list");
	await page.goForward();
	await expect(page).toHaveURL(issueUrl);
	await expect(page.getByRole("heading", { name: issueTitle, exact: true })).toBeVisible();
	await checkpoint(page, testInfo, "issue-forward-detail");
	await assertShell(page);
	await page.goto(projectUrl);
	await checkpoint(page, testInfo, "project");
	await page
		.getByRole("navigation", { name: "Project sections" })
		.getByRole("link", { name: "Wiki", exact: true })
		.click();
	await expect(page).toHaveURL((url) => url.pathname === "/wiki");
	const wikiScope = new URL(page.url());
	expect(wikiScope.searchParams.get("workspace")).toBe("projektor");
	expect(wikiScope.searchParams.get("projectId")).toBe(
		new URL(projectUrl).searchParams.get("projectId"),
	);
	await checkpoint(page, testInfo, "project-scoped-wiki");
	const pages = page.getByRole("button", { name: "Pages", exact: true });
	if (await pages.isVisible()) await pages.click();
	await page.getByRole("button", { name: "+ New page", exact: true }).click();
	const wikiTitle = `Native wiki ${suffix}`;
	await page.getByPlaceholder("Page title", { exact: true }).fill(wikiTitle);
	const editor = page.getByRole("textbox", { name: "Markdown editor", exact: true });
	await expect(editor).toBeVisible();
	await editor.fill(
		`## Comark acceptance ${suffix}\n\nA **strong** native paragraph.\n\n- One\n- Two\n\n[Scoped project](${projectUrl})\n\n<script>window.__acceptanceInjected = true</script>`,
	);
	await checkpoint(page, testInfo, "native-wiki-form");
	await page.getByRole("button", { name: "Create page", exact: true }).click();
	await expect(page.getByRole("heading", { name: wikiTitle, exact: true, level: 1 })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: `Comark acceptance ${suffix}`, exact: true, level: 2 }),
	).toBeVisible();
	await expect(page.locator("strong").filter({ hasText: /^strong$/ })).toBeVisible();
	await expect(page.getByRole("link", { name: "Scoped project", exact: true })).toHaveAttribute(
		"href",
		projectUrl,
	);
	expect(await page.evaluate(() => "__acceptanceInjected" in window)).toBe(false);
	await checkpoint(page, testInfo, "wiki-created-comark-render");
	await expect(page).toHaveURL((url) => url.pathname.startsWith("/wiki/"));
	const wikiUrl = page.url();
	expect(new URL(wikiUrl).searchParams.get("workspace")).toBe("projektor");
	expect(new URL(wikiUrl).searchParams.get("projectId")).toBe(
		new URL(projectUrl).searchParams.get("projectId"),
	);
	await page.reload();
	await expect(page.getByRole("heading", { name: wikiTitle, exact: true, level: 1 })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: `Comark acceptance ${suffix}`, exact: true, level: 2 }),
	).toBeVisible();
	expect(await page.evaluate(() => "__acceptanceInjected" in window)).toBe(false);
	await checkpoint(page, testInfo, "wiki-reload-comark-render");
	// A fresh document with JS disabled proves the mutation reached real D1,
	// rather than being held in hydrated component state.
	const noJs = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
		viewport: page.viewportSize(),
	});
	try {
		const cold = await noJs.newPage();
		observeBrowser(cold, testInfo);
		expect((await cold.goto(issueUrl))?.status()).toBe(200);
		await expect(cold.getByRole("heading", { name: issueTitle, exact: true })).toBeVisible();
		await checkpoint(cold, testInfo, "cold-persisted-issue-no-js");
	} finally {
		await noJs.close();
	}
	expect(errors).toEqual([]);
});
