// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import pkg from "../../../package.json";
import type { RequestScope } from "../server/request-context";
import { Shell } from "./Shell";

const workspace = { id: "workspace-1", slug: "team", name: "Team", role: "owner" } as const;
const scope: RequestScope = {
	user: { id: "user-1", name: "User", email: "user@example.test" },
	workspaces: [workspace],
	projects: [],
	selection: { kind: "workspace", workspace },
};

function viewport(width: number) {
	vi.stubGlobal("innerWidth", width);
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: query.includes("max-width") && width < 768,
		media: query,
		addEventListener() {},
		removeEventListener() {},
	}));
}

beforeEach(() => {
	localStorage.clear();
	viewport(1440);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	cleanup();
	localStorage.clear();
	document.documentElement.removeAttribute("data-theme");
	document.documentElement.removeAttribute("data-density");
	document.documentElement.removeAttribute("data-sidebar");
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("generated Base UI Shell", () => {
	it("reads the preserved application version from the single private root package", () => {
		expect(pkg.private).toBe(true);
		expect(pkg.version).toBe("0.7.6");
	});

	it("server renders generated sidebar landmarks and request-local workspace links", () => {
		const element = document.createElement("div");
		element.innerHTML = renderToString(
			<Shell scope={scope} pathname="/settings/groups">
				<h1>Groups</h1>
			</Shell>,
		);
		expect(element.querySelector('[data-slot="sidebar-wrapper"]')).not.toBeNull();
		expect(element.querySelector('main[data-slot="sidebar-inset"]')?.id).toBe("main-content");
		expect(element.querySelector(".app-main, .drawer-overlay, .sidebar")).toBeNull();
		const links = element.querySelectorAll('[data-slot="sidebar-menu-button"]');
		expect(links.length).toBe(4);
		for (const link of links)
			expect(
				new URL(link.getAttribute("href")!, "https://app.test").searchParams.get("workspace"),
			).toBe("team");
		expect(element.querySelector('a[aria-current="page"]')?.textContent).toBe("Groups");
		expect(element.textContent).toContain(`v${pkg.version}`);
	});

	it("retains a native login POST and the exact server return URL", () => {
		render(
			<Shell scope={null} pathname="/help" returnTo="/help?workspace=team">
				<h1>Help</h1>
			</Shell>,
		);
		const form = (screen.getByRole("button", { name: "Log in" }) as HTMLButtonElement).form!;
		expect(form.getAttribute("method")).toBe("post");
		expect(form.getAttribute("action")).toBe("/auth/session");
		expect(new FormData(form).get("action")).toBe("login");
		expect(new FormData(form).get("redirect_url")).toBe("/help?workspace=team");
	});

	it("uses the generated portal menu while auth controls stay associated with persistent native forms", async () => {
		render(
			<Shell scope={scope} pathname="/settings/groups" returnTo="/settings/groups?workspace=team">
				<h1>Groups</h1>
			</Shell>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Account: User" }));
		const refresh = (await screen.findByRole("menuitem", {
			name: "Refresh session",
		})) as HTMLButtonElement;
		const logout = screen.getByRole("menuitem", { name: "Log out" }) as HTMLButtonElement;
		expect(refresh.tagName).toBe("BUTTON");
		expect(logout.tagName).toBe("BUTTON");
		const refreshForm = refresh.form!;
		const logoutForm = logout.form!;
		expect(refreshForm.closest('[data-slot="dropdown-menu-content"]')).toBeNull();
		expect(logoutForm.getAttribute("method")).toBe("post");
		expect(new FormData(refreshForm).get("redirect_url")).toBe("/settings/groups?workspace=team");
		expect(new FormData(logoutForm).get("action")).toBe("logout");
		const submit = vi.fn((event: Event) => event.preventDefault());
		refreshForm.addEventListener("submit", submit);
		fireEvent.click(refresh);
		expect(submit).toHaveBeenCalledTimes(1);
		await waitFor(() =>
			expect(screen.queryByRole("menuitem", { name: "Refresh session" })).toBeNull(),
		);
		expect(document.getElementById(refreshForm.id)).toBe(refreshForm);
	});

	it("lets the generated provider collapse desktop navigation and persist cosmetic preferences", () => {
		const { container } = render(
			<Shell scope={scope} pathname="/">
				<h1>Projects</h1>
			</Shell>,
		);
		fireEvent.keyDown(window, { key: "b", ctrlKey: true });
		expect(container.querySelector('[data-slot="sidebar"][data-state="collapsed"]')).not.toBeNull();
		expect(JSON.parse(localStorage.getItem("prefs")!).sidebar).toBe("collapsed");
		expect(Object.keys(JSON.parse(localStorage.getItem("prefs")!)).sort()).toEqual([
			"density",
			"sidebar",
			"theme",
		]);
	});

	it("opens and dismisses the generated mobile Sheet, not a manual drawer", async () => {
		viewport(390);
		render(
			<Shell scope={scope} pathname="/">
				<h1>Projects</h1>
			</Shell>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
		const dialog = await screen.findByRole("dialog", { name: "Sidebar" });
		expect(dialog.getAttribute("data-mobile")).toBe("true");
		const link = screen.getByRole("link", { name: "My Issues" });
		expect(link.getAttribute("href")).toBe("/my-issues?workspace=team");
		// jsdom cannot perform native document navigation. Only suppress its default navigation,
		// leaving the real generated Sheet and the Shell's close-on-navigation handler intact.
		link.addEventListener("click", (event) => event.preventDefault());
		fireEvent.click(link);
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sidebar" })).toBeNull());
	});

	it("leaves Wiki full bleed while other pages use the shell's one content gutter", () => {
		const { container, rerender } = render(
			<Shell scope={scope} pathname="/wiki/page">
				<div>Wiki</div>
			</Shell>,
		);
		expect(
			container.querySelector(".projektor-page-content")?.getAttribute("data-full-bleed"),
		).toBe("true");
		rerender(
			<Shell scope={scope} pathname="/help">
				<div className="page-container">Help</div>
			</Shell>,
		);
		expect(
			container.querySelector(".projektor-page-content")?.hasAttribute("data-full-bleed"),
		).toBe(false);
	});
});
