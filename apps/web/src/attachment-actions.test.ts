import { Effect } from "effect";
import { HttpBody, HttpClientRequest } from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";

import { actionFixture, formData } from "./features/planning/action-test-fixture";
import { serviceBindingHttpClient } from "./http-client-layer";

const { uploadAttachment, uploadInlineImage } = await import("./attachment-actions");

const uploaded = { id: "file-1", filename: "diagram.png", contentType: "image/png", size: 4 };
function nativeInput() {
	const fields = formData({ workspaceSlug: "alpha", entityType: "wiki_page", entityId: "wiki-1" });
	fields.set(
		"file",
		new File([new Uint8Array([0, 255, 7, 128])], "diagram.png", { type: "image/png" }),
	);
	return fields;
}

describe("individual attachment ServerFns", () => {
	it.each(["native", "inline"] as const)(
		"preserves the multipart boundary and 64 KiB file through the real binding adapter (%s)",
		async (kind) => {
			const bytes = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 256);
			const file = new File([bytes], "native-attachment.bin", {
				type: "application/octet-stream",
			});
			const metadata = {
				id: "file-64k",
				filename: file.name,
				contentType: file.type,
				size: file.size,
			};
			const binding = serviceBindingHttpClient({
				async fetch(request: Request) {
					expect(request.headers.get("x-workspace-slug")).toBe("alpha");
					expect(request.headers.get("cookie")).toBe("CF_Authorization=actual-user");
					expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=.+/);
					// This is the unchanged API upload parser's actual Web Request boundary.
					const fields = await request.formData();
					expect(fields.get("entityType")).toBe("wiki_page");
					expect(fields.get("entityId")).toBe("wiki-1");
					const received = fields.get("file");
					if (!(received instanceof File)) throw new Error("Expected multipart file");
					expect(received.name).toBe(file.name);
					expect(received.type).toBe(file.type);
					expect(received.size).toBe(bytes.length);
					expect(new Uint8Array(await received.arrayBuffer())).toEqual(bytes);
					return Response.json(metadata, { status: 201 });
				},
			} as Parameters<typeof serviceBindingHttpClient>[0]);
			const fixture = actionFixture(async (url, options) => {
				// The fixture's FetchHttpClient exposes the action's outgoing body/headers.
				// Replay them through the production Alchemy adapter, not native fetch.
				const request = HttpClientRequest.post(url).pipe(
					HttpClientRequest.setHeaders(new Headers(options?.headers)),
				);
				const outgoing =
					options?.body instanceof FormData
						? HttpClientRequest.bodyFormData(request, options.body)
						: HttpClientRequest.setBody(request, HttpBody.raw(options?.body));
				return Effect.runPromise(
					Effect.scoped(
						binding.execute(outgoing).pipe(Effect.flatMap((response) => response.json)),
					),
				);
			});
			const fields = nativeInput();
			fields.set("file", file);
			const result =
				kind === "native"
					? fixture.invoke(uploadAttachment, null, fields)
					: fixture.invoke(uploadInlineImage, {
							workspaceSlug: "alpha",
							entityType: "wiki_page",
							entityId: "wiki-1",
							file,
						});
			await expect(result).resolves.toEqual({ ok: true, value: metadata });
			expect(fixture.invalidated).toHaveBeenCalledOnce();
		},
	);
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
			}),
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
			Response.json({ error: "Upload rejected" }, { status: 413 }),
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
