import { describe, expect, it } from "vitest";
import { actionFixture, formData } from "./action-test-fixture";
import { calendarTimestamp } from "./input-schemas";

const actions = await import("./actions");
const scope = { workspaceSlug: "alpha", projectId: "p1" };
const draft = {
	...scope,
	name: " Sprint ",
	goal: " Goal ",
	start: "2026-10-04",
	end: "",
	startOffset: -540,
	endOffset: 0,
};
const sprint = {
	id: "s1",
	projectId: "p1",
	name: "Sprint",
	goal: null,
	startDate: null,
	endDate: null,
	status: "planned",
	createdAt: 1,
};
const writes = (fixture: ReturnType<typeof actionFixture>) =>
	fixture.transport.mock.calls.filter(([, options]) => options?.method !== "GET");

describe("explicit planning ServerFn schemas and Effect handlers", () => {
	it("rejects missing native scope fields and invalid string-decoded timezone offsets before HTTP", async () => {
		const fixture = actionFixture(() => ({ id: "created" }));
		const missingScope = formData(draft);
		missingScope.delete("workspaceSlug");
		await expect(fixture.invoke(actions.createSprint, null, missingScope)).rejects.toMatchObject({
			_tag: "SchemaError",
		});
		await expect(
			fixture.invoke(actions.createSprint, null, formData({ ...draft, startOffset: 900 }))
		).rejects.toMatchObject({ _tag: "SchemaError" });
		expect(fixture.transport).not.toHaveBeenCalled();
	});
	it("creates through a fixed server-only contract and preserves local-midnight calendar offsets", async () => {
		const fixture = actionFixture(() => ({ id: "created" }));
		expect(await fixture.invoke(actions.createSprint, null, formData(draft))).toEqual({
			ok: true,
			value: { id: "created" },
		});
		const [url, options] = writes(fixture)[0];
		expect(String(url)).toBe("https://api.example/api/sprints");
		expect(options?.method).toBe("POST");
		expect(JSON.parse(String(options?.body))).toEqual({
			projectId: "p1",
			name: "Sprint",
			goal: "Goal",
			startDate: calendarTimestamp(draft.start, -540),
		});
		expect(new Headers(options?.headers).get("x-workspace-slug")).toBe("alpha");
		expect(new Headers(options?.headers).get("authorization")).toBe("Bearer actual-user");
		expect(fixture.invalidated).toHaveBeenCalledTimes(1);
	});
	it("edits canonical source sprint fields and explicitly clears optional dates/goal", async () => {
		const fixture = actionFixture((_url, options) =>
			options?.method === "GET" ? sprint : { ok: true }
		);
		expect(
			await fixture.invoke(
				actions.editSprint,
				null,
				formData({ ...draft, sprintId: "s1", goal: "", start: "" })
			)
		).toEqual({ ok: true, value: { ok: true } });
		expect(JSON.parse(String(writes(fixture)[0][1]?.body))).toEqual({
			name: "Sprint",
			goal: null,
			startDate: null,
			endDate: null,
		});
		expect(writes(fixture)[0][1]?.method).toBe("PATCH");
	});
	it.each(["planned", "active", "completed"] as const)(
		"changes status to %s after authoritative sprint/project lookup",
		async (status) => {
			const fixture = actionFixture((_url, options) =>
				options?.method === "GET" ? sprint : { ok: true }
			);
			expect(
				await fixture.invoke(actions.setSprintStatus, { ...scope, sprintId: "s1", status })
			).toEqual({ ok: true, value: { ok: true } });
			expect(JSON.parse(String(writes(fixture)[0][1]?.body))).toEqual({ status });
			expect(fixture.invalidated).toHaveBeenCalledTimes(1);
		}
	);
	it("archives through DELETE only after a matching scoped sprint lookup", async () => {
		const fixture = actionFixture((_url, options) =>
			options?.method === "GET" ? sprint : { ok: true }
		);
		expect(await fixture.invoke(actions.archiveSprint, { ...scope, sprintId: "s1" })).toEqual({
			ok: true,
			value: { ok: true },
		});
		expect(writes(fixture)[0][1]?.method).toBe("DELETE");
		expect(String(writes(fixture)[0][0])).toContain("/api/sprints/s1");
	});
	it("rejects foreign selectors, foreign sprint IDs and cross-origin callers before mutation", async () => {
		const selector = actionFixture(() => ({ id: "created" }));
		expect(
			await selector.invoke(
				actions.createSprint,
				null,
				formData({ ...draft, workspaceSlug: "beta" })
			)
		).toMatchObject({ ok: false, status: 403 });
		expect(writes(selector)).toEqual([]);
		const foreign = actionFixture(() => ({ ...sprint, projectId: "other" }));
		expect(await foreign.invoke(actions.archiveSprint, { ...scope, sprintId: "s1" })).toMatchObject(
			{ ok: false, status: 404 }
		);
		expect(writes(foreign)).toEqual([]);
		const origin = actionFixture(() => ({ id: "created" }), "https://foreign.example");
		expect(await origin.invoke(actions.createSprint, null, formData(draft))).toMatchObject({
			ok: false,
			status: 403,
		});
		expect(origin.transport).not.toHaveBeenCalled();
		expect(origin.invalidated).toHaveBeenCalledTimes(1);
	});
	it("checks source/target and each selected issue with bounded fan-out before moving", async () => {
		let active = 0;
		let max = 0;
		const fixture = actionFixture(async (url, options) => {
			if (options?.method === "POST") return { ok: true, count: 8 };
			if (url.pathname.startsWith("/api/sprints/"))
				return { ...sprint, id: url.pathname.endsWith("s2") ? "s2" : "s1" };
			active += 1;
			max = Math.max(max, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return { id: url.pathname.split("/").at(-1), project_id: "p1", sprint_id: "s1" };
		});
		const issueIds = Array.from({ length: 8 }, (_, index) => `i${index}`);
		expect(
			await fixture.invoke(actions.moveSprintIssues, {
				...scope,
				sprintId: "s1",
				targetId: "s2",
				issueIds,
			})
		).toEqual({ ok: true, value: { ok: true, count: 8 } });
		expect(max).toBe(4);
		expect(String(writes(fixture)[0][0])).toContain("/api/sprints/s2/move-issues");
		expect(JSON.parse(String(writes(fixture)[0][1]?.body))).toEqual({ issueIds });
	});
	it("fails stale or foreign issue selections without a write, and validates shared form fields before HTTP", async () => {
		const stale = actionFixture((url) =>
			url.pathname.startsWith("/api/sprints/")
				? { ...sprint, id: url.pathname.endsWith("s2") ? "s2" : "s1" }
				: { id: "i1", project_id: "p1", sprint_id: "other" }
		);
		expect(
			await stale.invoke(actions.moveSprintIssues, {
				...scope,
				sprintId: "s1",
				targetId: "s2",
				issueIds: ["i1"],
			})
		).toMatchObject({ ok: false, status: 404 });
		expect(writes(stale)).toEqual([]);
		const invalid = actionFixture(() => ({ id: "created" }));
		await expect(
			invalid.invoke(actions.createSprint, null, formData({ ...draft, name: "  " }))
		).rejects.toMatchObject({ _tag: "SchemaError" });
		await expect(
			invalid.invoke(
				actions.editSprint,
				null,
				formData({ ...draft, sprintId: "s1", end: "2026-10-01" })
			)
		).rejects.toMatchObject({ _tag: "SchemaError" });
		expect(invalid.transport).not.toHaveBeenCalled();
	});
});
