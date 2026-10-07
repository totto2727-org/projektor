import { describe, expect, it } from "vite-plus/test";
import { CreateProjectSchema, UpdateProjectSchema } from "../../../api/schemas/projects";
import { actionFixture, formData } from "../planning/action-test-fixture";

const { createProject, updateDescription, archiveProject } = await import("./actions");

describe("project native form API contract", () => {
	it("creates a project with a blank optional description using the unchanged backend schema", async () => {
		const fixture = actionFixture(async (url, options) => {
			expect(url.pathname).toBe("/api/projects");
			const body = CreateProjectSchema.parse(JSON.parse(await new Response(options?.body).text()));
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
				}),
			),
		).resolves.toMatchObject({ ok: true, value: { id: "created" } });
	});

	it("clears the description with an accepted empty string rather than unsupported null", async () => {
		const fixture = actionFixture(async (url, options) => {
			expect(url.pathname).toBe("/api/projects/p1");
			expect(
				UpdateProjectSchema.parse(JSON.parse(await new Response(options?.body).text())),
			).toEqual({
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
				}),
			),
		).resolves.toEqual({ ok: true, value: { ok: true } });
	});

	it("archives through the unchanged API after resolving the actual D1 project catalog", async () => {
		const fixture = actionFixture(async (url, options) => {
			expect(url.pathname).toBe("/api/projects/p1");
			expect(options?.method).toBe("PATCH");
			expect(
				UpdateProjectSchema.parse(JSON.parse(await new Response(options?.body).text())),
			).toEqual({ archived: true });
			return { ok: true };
		});
		await expect(
			fixture.invoke(archiveProject, { workspaceSlug: "alpha", projectId: "p1", archived: true }),
		).resolves.toEqual({ ok: true, value: { ok: true } });
		const readPaths = fixture.transport.mock.calls
			.filter(([, options]) => options?.method === "GET")
			.map(([input]) => new URL(input instanceof Request ? input.url : input.toString()).pathname);
		expect(readPaths).toEqual(["/auth/me"]);
	});

	it("rejects a foreign project from real D1 before the project PATCH", async () => {
		const fixture = actionFixture(() => {
			throw new Error("Must not mutate a foreign project");
		});
		await expect(
			fixture.invoke(archiveProject, {
				workspaceSlug: "alpha",
				projectId: "foreign",
				archived: true,
			}),
		).resolves.toMatchObject({ ok: false, status: 404 });
		expect(fixture.transport.mock.calls.filter(([, options]) => options?.method !== "GET")).toEqual(
			[],
		);
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
				}),
			),
		).rejects.toBeDefined();
		expect(fixture.transport).not.toHaveBeenCalled();
	});
});
