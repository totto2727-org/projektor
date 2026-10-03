import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { PUBLIC_VIEWER_EMAIL } from "../utils/public-viewer";
import ProjectList from "./ProjectList";

function mockFetchOk(payload: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) })
	);
}

function mockFetchByUrl(routes: { projects: unknown[]; meEmail: string }) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockImplementation((url: string) => {
			if (String(url).includes("/auth/me")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ user: { id: "u1", email: routes.meEmail, name: "User" } }),
				});
			}
			if (url === "/api/workspaces") return Promise.resolve(response([OWNER]));
			return Promise.resolve({ ok: true, json: () => Promise.resolve(routes.projects) });
		})
	);
}

const PROJECT = {
	id: "p1",
	name: "Projektor",
	key: "PROJ",
	description: "An issue tracker",
	workspace_id: "w1",
	workspace_name: "WS",
	workspace_slug: "ws",
	open_issue_count: 3,
	backlog_issue_count: 0,
	archived_at: null,
	created_at: 0,
	updated_at: 0,
};

describe("ProjectList", () => {
	it("shows the loading state before the fetch resolves", () => {
		vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
		render(<ProjectList />);
		expect(screen.getByText(/Loading projects/i)).toBeTruthy();
	});

	it("shows the empty state when no projects are returned", async () => {
		mockFetchOk([]);
		render(<ProjectList />);
		expect(await screen.findByText(/No projects yet/i)).toBeTruthy();
	});

	it("renders a card with the project name, key and open count when there's no backlog", async () => {
		mockFetchOk([PROJECT]);
		render(<ProjectList />);
		expect(await screen.findByText("Projektor")).toBeTruthy();
		expect(screen.getByText("PROJ")).toBeTruthy();
		expect(screen.getByText("3 open")).toBeTruthy();
	});

	it("splits the count into open and backlog when the project has backlog issues (PROJ-849)", async () => {
		mockFetchOk([{ ...PROJECT, open_issue_count: 10, backlog_issue_count: 4 }]);
		render(<ProjectList />);
		expect(await screen.findByText("Projektor")).toBeTruthy();
		expect(screen.getByText("6 open · 4 backlog")).toBeTruthy();
	});

	it("shows an error message when the request fails", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
		render(<ProjectList />);
		expect(await screen.findByText(/Failed to load projects/i)).toBeTruthy();
	});
});

describe("ProjectList archived projects (PROJ-649)", () => {
	it("does not request archived projects by default", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
		vi.stubGlobal("fetch", fetchMock);
		render(<ProjectList />);
		await screen.findByText(/No projects yet/i);
		expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.anything());
	});

	it("refetches with includeArchived when the toggle is checked", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
		vi.stubGlobal("fetch", fetchMock);
		render(<ProjectList />);
		await screen.findByText(/No projects yet/i);
		fireEvent.click(screen.getByLabelText(/Show archived/i));
		await screen.findByText(/No projects yet/i);
		expect(fetchMock).toHaveBeenCalledWith("/api/projects?includeArchived=true", expect.anything());
	});

	it("shows an Archived badge for an archived project", async () => {
		mockFetchOk([{ ...PROJECT, archived_at: 1700000000 }]);
		render(<ProjectList />);
		expect(await screen.findByText("Projektor")).toBeTruthy();
		expect(screen.getByText("Archived")).toBeTruthy();
	});
});

describe("ProjectList public read-only demo viewer (PROJ-568)", () => {
	it("hides the create-project button for the public viewer", async () => {
		mockFetchByUrl({ projects: [], meEmail: "public-viewer@projektor.local" });
		render(<ProjectList />);
		await screen.findByText(/No projects yet/i);
		expect(await screen.findByText(/Read-only demo/i)).toBeTruthy();
		expect(screen.queryByText("+ New project")).toBeNull();
	});

	it("shows the create-project button for a real user with a writable workspace", async () => {
		mockFetchByUrl({ projects: [], meEmail: "real-user@example.com" });
		render(<ProjectList />);
		await screen.findByText(/No projects yet/i);
		expect(await screen.findByText("+ New project")).toBeTruthy();
		expect(screen.queryByText(/Read-only demo/i)).toBeNull();
	});
});

const OWNER = { id: "w1", name: "Personal", slug: "personal", role: "owner" };
const ADMIN = { id: "w2", name: "Team", slug: "team", role: "admin" };
const MEMBER = { id: "w3", name: "Members", slug: "members", role: "member" };
const VIEWER = { id: "w4", name: "Read only", slug: "read-only", role: "viewer" };

function response(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function stubApi({
	workspaces = [OWNER],
	workspaceResponse,
	postResponse,
	email = "owner@example.test",
}: {
	workspaces?: (typeof OWNER)[];
	workspaceResponse?: () => Promise<Response>;
	postResponse?: () => Promise<Response>;
	email?: string;
} = {}) {
	const fetchMock = vi.fn((path: string, init?: RequestInit) => {
		if (path === "/api/workspaces") {
			return workspaceResponse?.() ?? Promise.resolve(response(workspaces));
		}
		if (path === "/auth/me") return Promise.resolve(response({ user: { email } }));
		if (path.startsWith("/api/workspaces/")) {
			return Promise.resolve(response({ currentUserRole: "owner" }));
		}
		if (path === "/api/projects" && init?.method === "POST") {
			return (
				postResponse?.() ??
				Promise.resolve(
					response({ id: "p1", name: "My project", key: "MYPROJECT", slug: "my-project" })
				)
			);
		}
		return Promise.resolve(response([]));
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function posts(fetchMock: ReturnType<typeof stubApi>) {
	return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

async function openForm() {
	fireEvent.click(await screen.findByRole("button", { name: "+ New project" }));
	fireEvent.input(screen.getByLabelText("Name *"), { target: { value: "My project" } });
	await waitFor(() =>
		expect((screen.getByLabelText("Key *") as HTMLInputElement).value).toBe("MYPROJECT")
	);
	return screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
}

async function chooseWorkspace(name: string) {
	fireEvent.click(screen.getByRole("combobox", { name: "Workspace" }));
	fireEvent.click(await screen.findByRole("option", { name }));
}

describe("ProjectList creation workspace", () => {
	it.each([OWNER, ADMIN])(
		"auto-selects a single permitted $role workspace and sends the actual POST header",
		async (workspace) => {
			const fetchMock = stubApi({ workspaces: [MEMBER, workspace, VIEWER] });
			render(<ProjectList />);
			const submit = await openForm();
			expect(screen.queryByRole("combobox", { name: "Workspace" })).toBeNull();
			expect(screen.getByText(`${workspace.name} (${workspace.slug})`)).toBeTruthy();
			expect(submit.disabled).toBe(false);
			fireEvent.click(submit);
			await screen.findByRole("link", { name: /My project/ });
			expect(posts(fetchMock)).toHaveLength(1);
			const [path, init] = posts(fetchMock)[0];
			expect(path).toBe("/api/projects");
			expect(new Headers(init?.headers).get("X-Workspace-Slug")).toBe(workspace.slug);
			expect(init?.credentials).toBe("include");
			expect(JSON.parse(String(init?.body))).toEqual({ name: "My project", key: "MYPROJECT" });
			const workspaceRequest = fetchMock.mock.calls.find(([path]) => path === "/api/workspaces");
			expect(workspaceRequest?.[1]?.credentials).toBe("include");
			expect(new Headers(workspaceRequest?.[1]?.headers).has("X-Workspace-Slug")).toBe(false);
		}
	);

	it("requires explicit selection among multiple permitted workspaces and excludes member/viewer", async () => {
		const fetchMock = stubApi({ workspaces: [OWNER, MEMBER, ADMIN, VIEWER] });
		render(<ProjectList />);
		const submit = await openForm();
		expect(screen.getByRole("combobox", { name: "Workspace" }).textContent).toContain(
			"Choose a workspace"
		);
		expect(submit.disabled).toBe(true);
		// The submit handler must guard against keyboard/programmatic submission too.
		fireEvent.submit(submit.closest("form") as HTMLFormElement);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"Choose a workspace before creating a project."
		);
		expect(posts(fetchMock)).toHaveLength(0);
		fireEvent.click(screen.getByRole("combobox", { name: "Workspace" }));
		expect(screen.getAllByRole("option")).toHaveLength(2);
		expect(screen.queryByRole("option", { name: /Members|Read only/ })).toBeNull();
		fireEvent.click(screen.getByRole("option", { name: "Team (team)" }));
		expect(submit.disabled).toBe(false);
		fireEvent.click(submit);
		await screen.findByRole("link", { name: /My project/ });
		expect(new Headers(posts(fetchMock)[0][1]?.headers).get("X-Workspace-Slug")).toBe("team");
	});

	it("preserves an explicit workspaceSlug rather than selecting another writable workspace", async () => {
		const fetchMock = stubApi({ workspaces: [OWNER, ADMIN] });
		render(<ProjectList workspaceSlug="team" />);
		const submit = await openForm();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.getByText("Team (team)")).toBeTruthy();
		fireEvent.click(submit);
		await screen.findByRole("link", { name: /My project/ });
		expect(new Headers(posts(fetchMock)[0][1]?.headers).get("X-Workspace-Slug")).toBe("team");
	});

	it.each([
		{ workspaces: [] },
		{ workspaces: [MEMBER, VIEWER] },
		{ workspaces: [{ ...OWNER, role: "unknown" }] },
	])(
		"handles no permitted workspaces without issuing a POST ($workspaces)",
		async ({ workspaces }) => {
			const fetchMock = stubApi({ workspaces });
			render(<ProjectList />);
			expect(await screen.findByText(/need an owner or admin workspace role/)).toBeTruthy();
			expect(screen.queryByRole("button", { name: "+ New project" })).toBeNull();
			expect(posts(fetchMock)).toHaveLength(0);
		}
	);

	it("does not substitute another workspace for an inaccessible explicit slug", async () => {
		const fetchMock = stubApi({ workspaces: [OWNER, VIEWER] });
		render(<ProjectList workspaceSlug="read-only" />);
		expect(await screen.findByText(/need an owner or admin workspace role/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "+ New project" })).toBeNull();
		expect(posts(fetchMock)).toHaveLength(0);
	});

	it("keeps creation unavailable while workspace memberships are pending", async () => {
		let resolve!: (value: Response) => void;
		const fetchMock = stubApi({
			workspaceResponse: () =>
				new Promise((r) => {
					resolve = r;
				}),
		});
		render(<ProjectList />);
		expect(await screen.findByRole("status")).toHaveProperty("textContent", "Loading workspaces…");
		expect(screen.queryByRole("button", { name: "+ New project" })).toBeNull();
		expect(posts(fetchMock)).toHaveLength(0);
		await act(async () => resolve(response([OWNER])));
		expect(await screen.findByRole("button", { name: "+ New project" })).toBeTruthy();
	});

	it.each([403, 500])("surfaces a workspace HTTP %i error and can retry", async (status) => {
		let fail = true;
		const fetchMock = stubApi({
			workspaceResponse: async () =>
				response(fail ? { error: "Unavailable" } : [OWNER], fail ? status : 200),
		});
		render(<ProjectList />);
		expect((await screen.findByRole("alert")).textContent).toContain(
			`Failed to load workspaces: ApiError: API GET /api/workspaces failed: ${status}`
		);
		expect(screen.queryByRole("button", { name: "+ New project" })).toBeNull();
		fail = false;
		fireEvent.click(screen.getByRole("button", { name: "Retry workspaces" }));
		await screen.findByRole("button", { name: "+ New project" });
		expect(fetchMock.mock.calls.filter(([path]) => path === "/api/workspaces")).toHaveLength(2);
	});

	it("handles offline workspace resolution gracefully", async () => {
		stubApi({ workspaceResponse: () => Promise.reject(new Error("offline")) });
		render(<ProjectList />);
		expect((await screen.findByRole("alert")).textContent).toContain("network unavailable");
		expect(screen.queryByRole("button", { name: "+ New project" })).toBeNull();
	});

	it("keeps the selected workspace and form after a failed POST so retry sends the same slug", async () => {
		let fail = true;
		const fetchMock = stubApi({
			workspaces: [OWNER, ADMIN],
			postResponse: async () =>
				response(
					fail
						? { error: "Denied" }
						: { id: "p1", name: "My project", key: "MYPROJECT", slug: "my-project" },
					fail ? 403 : 200
				),
		});
		render(<ProjectList />);
		await openForm();
		await chooseWorkspace("Team (team)");
		fireEvent.click(screen.getByRole("button", { name: "Create project" }));
		expect((await screen.findByRole("alert")).textContent).toContain("failed: 403");
		expect(screen.getByRole("combobox").textContent).toContain("Team (team)");
		fail = false;
		fireEvent.click(screen.getByRole("button", { name: "Create project" }));
		await screen.findByRole("link", { name: /My project/ });
		expect(posts(fetchMock)).toHaveLength(2);
		for (const [, init] of posts(fetchMock)) {
			expect(new Headers(init?.headers).get("X-Workspace-Slug")).toBe("team");
		}
	});

	it("never offers creation to the public viewer, even if workspace data claims owner", async () => {
		const fetchMock = stubApi({ email: PUBLIC_VIEWER_EMAIL });
		render(<ProjectList />);
		expect(await screen.findByText(/Read-only demo/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "+ New project" })).toBeNull();
		expect(posts(fetchMock)).toHaveLength(0);
	});

	it("discards a previous selection when the explicit workspace prop changes", async () => {
		const fetchMock = stubApi({ workspaces: [OWNER, ADMIN] });
		const view = render(<ProjectList workspaceSlug="personal" />);
		await openForm();
		view.rerender(<ProjectList workspaceSlug="team" />);
		await screen.findByText("Team (team)");
		fireEvent.click(screen.getByRole("button", { name: "Create project" }));
		await screen.findByRole("link", { name: /My project/ });
		expect(new Headers(posts(fetchMock)[0][1]?.headers).get("X-Workspace-Slug")).toBe("team");
	});
});
