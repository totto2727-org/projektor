import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import { sessionNavigation as navigate } from "./session-navigation";

const sessionNavigation = (request: Request) =>
	Effect.runPromise(navigate(request).pipe(Effect.map(HttpServerResponse.toWeb)));

const origin = "https://frontend.example";
function form(fields: Record<string, string>, requestOrigin = origin) {
	return new Request(`${origin}/auth/session`, {
		method: "POST",
		headers: { origin: requestOrigin },
		body: new URLSearchParams(fields),
	});
}

describe("native session document navigation", () => {
	it("redirects a native login POST back to the same scoped local page", async () => {
		const path = "/issues?workspace=beta&projectId=p#active";
		const response = await sessionNavigation(form({ action: "login", redirect_url: path }));
		expect(response.status).toBe(303);
		const target = new URL(response.headers.get("location") ?? "", origin);
		expect(target.pathname).toBe("/auth/login");
		expect(target.searchParams.get("redirect_url")).toBe(path);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});
	it("redirects logout only to the same-origin Access document endpoint", async () => {
		const response = await sessionNavigation(
			form({ action: "logout", redirect_url: "https://evil.example" })
		);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/cdn-cgi/access/logout");
	});
	it.each(["https://evil.example/", "//evil.example/", "/\\evil.example/", "javascript:alert(1)"])(
		"rejects nonlocal login redirect %s",
		async (redirect_url) => {
			await expect(
				sessionNavigation(form({ action: "login", redirect_url }))
			).rejects.toMatchObject({ status: 400 });
		}
	);
	it("rejects cross-origin POST, oversized forms, unsupported actions and non-POST navigation", async () => {
		await expect(
			sessionNavigation(form({ action: "logout" }, "https://evil.example"))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			sessionNavigation(form({ action: "login", redirect_url: `/${"x".repeat(8192)}` }))
		).rejects.toMatchObject({ status: 400 });
		await expect(sessionNavigation(form({ action: "unknown" }))).rejects.toMatchObject({
			status: 400,
		});
		expect((await sessionNavigation(new Request(`${origin}/auth/session`))).status).toBe(405);
	});
});
