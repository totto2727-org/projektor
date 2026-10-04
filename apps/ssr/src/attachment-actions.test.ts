import { describe, expect, it } from "vitest";

import { actionFixture, formData } from "./features/planning/action-test-fixture";

const { uploadAttachment, uploadInlineImage } = await import("./attachment-actions");

const uploaded = { id: "file-1", filename: "diagram.png", contentType: "image/png", size: 4 };
function nativeInput() {
	const fields = formData({ workspaceSlug: "alpha", entityType: "wiki_page", entityId: "wiki-1" });
	fields.set(
		"file",
		new File([new Uint8Array([0, 255, 7, 128])], "diagram.png", { type: "image/png" })
	);
	return fields;
}

describe("individual attachment ServerFns", () => {
	it("decodes the native FormData action and forwards the real file through the server HTTP client", async () => {
		const fixture = actionFixture(async (url, options) => {
			expect(url.pathname).toBe("/api/files");
			expect(options?.method).toBe("POST");
			expect(new Headers(options?.headers).get("x-workspace-slug")).toBe("alpha");
			const body = options?.body;
			if (!(body instanceof FormData))
				throw new Error("Expected framework-decoded multipart fields");
			expect(body.get("entityType")).toBe("wiki_page");
			expect(body.get("entityId")).toBe("wiki-1");
			const file = body.get("file");
			if (!(file instanceof File)) throw new Error("Expected original file");
			expect(file.name).toBe("diagram.png");
			expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 7, 128]));
			return uploaded;
		});
		await expect(fixture.invoke(uploadAttachment, null, nativeInput())).resolves.toEqual({
			ok: true,
			value: uploaded,
		});
		expect(fixture.invalidated).toHaveBeenCalledOnce();
	});

	it("returns the image identity for editor insertion without a separate upload endpoint", async () => {
		const fixture = actionFixture(() => uploaded);
		await expect(
			fixture.invoke(uploadInlineImage, {
				workspaceSlug: "alpha",
				entityType: "wiki_page",
				entityId: "wiki-1",
				file: nativeInput().get("file") as File,
			})
		).resolves.toEqual({ ok: true, value: uploaded });
		expect(fixture.invalidated).toHaveBeenCalledOnce();
	});

	it("rejects cross-origin native mutations before contacting the API", async () => {
		const fixture = actionFixture(() => {
			throw new Error("Must not execute");
		}, "https://other.example");
		await expect(fixture.invoke(uploadAttachment, null, nativeInput())).resolves.toMatchObject({
			ok: false,
			status: 403,
		});
		expect(fixture.transport).not.toHaveBeenCalled();
		expect(fixture.invalidated).toHaveBeenCalledOnce();
	});

	it("preserves an upstream rejection and validates the concrete upload response", async () => {
		const denied = actionFixture(() =>
			Response.json({ error: "Upload rejected" }, { status: 413 })
		);
		await expect(denied.invoke(uploadAttachment, null, nativeInput())).resolves.toMatchObject({
			ok: false,
			status: 413,
		});
		const malformed = actionFixture(() => ({ id: "missing-file-metadata" }));
		await expect(malformed.invoke(uploadAttachment, null, nativeInput())).resolves.toMatchObject({
			ok: false,
			status: 502,
		});
	});
});
