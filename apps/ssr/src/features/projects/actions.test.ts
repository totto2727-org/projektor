import { describe, expect, it } from "vitest";
import { CreateProjectSchema, UpdateProjectSchema } from "../../../../api/src/schemas/projects";
import { actionFixture, formData } from "../planning/action-test-fixture";

const { createProject, updateDescription } = await import("./actions");

describe("project native form API contract", () => {
	it("creates a project with a blank optional description using the unchanged backend schema", async () => {
		const fixture = actionFixture((url, options) => {
			expect(url.pathname).toBe("/api/projects");
			const body = CreateProjectSchema.parse(JSON.parse(String(options?.body)));
			expect(body).toEqual({ name: "New project", key: "NEW", description: "" });
			return { id: "created", name: body.name, key: body.key, slug: "new-project" };
		});
		await expect(
			fixture.invoke(
				createProject,
				null,
				formData({
					workspaceSlug: "alpha",
					name: "New project",
					key: "NEW",
					description: "",
				})
			)
		).resolves.toMatchObject({ ok: true, value: { id: "created" } });
	});

	it("clears the description with an accepted empty string rather than unsupported null", async () => {
		const fixture = actionFixture((url, options) => {
			expect(url.pathname).toBe("/api/projects/p1");
			expect(UpdateProjectSchema.parse(JSON.parse(String(options?.body)))).toEqual({
				description: "",
			});
			return { ok: true };
		});
		await expect(
			fixture.invoke(
				updateDescription,
				null,
				formData({
					workspaceSlug: "alpha",
					projectId: "p1",
					description: "",
				})
			)
		).resolves.toEqual({ ok: true, value: { ok: true } });
	});

	it("rejects leading-digit project keys in the shared Effect form schema before HTTP execution", async () => {
		const fixture = actionFixture(() => {
			throw new Error("Must not send invalid key");
		});
		await expect(
			fixture.invoke(
				createProject,
				null,
				formData({
					workspaceSlug: "alpha",
					name: "Invalid key",
					key: "1BAD",
					description: "",
				})
			)
		).rejects.toBeDefined();
		expect(fixture.transport).not.toHaveBeenCalled();
	});
});
