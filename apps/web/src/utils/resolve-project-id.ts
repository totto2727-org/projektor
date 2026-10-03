import { apiFetch } from "./api-client";

export interface ProjectIdCandidate {
	id: string;
}

export interface ResolveProjectIdResult<T extends ProjectIdCandidate> {
	project: T | null;
	projects: T[];
	error: string | null;
}

export function readUrlProjectId(): string | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	return params.get("projectId") || params.get("id");
}

export function persistProjectId(id: string): void {
	const params = new URLSearchParams(window.location.search);
	if (params.get("projectId") !== id) {
		params.set("projectId", id);
		history.replaceState(null, "", `?${params.toString()}`);
	}
}

export async function fetchProjects<T extends ProjectIdCandidate>(
	workspaceSlug: string | undefined,
	includeArchived = false
): Promise<T[]> {
	const list = await apiFetch<T[]>(
		`/api/projects${includeArchived ? "?includeArchived=true" : ""}`,
		{ workspaceSlug }
	);
	return Array.isArray(list) ? list : [];
}

export function matchProjectId<T extends ProjectIdCandidate>(
	projects: readonly T[],
	urlHint: string | null,
	matches: (project: T, hint: string) => boolean = (p, hint) => p.id === hint
): { project: T | null; error: string | null } {
	if (urlHint) {
		const matched = projects.find((p) => matches(p, urlHint)) ?? null;
		if (matched) {
			persistProjectId(matched.id);
			return { project: matched, error: null };
		}
		return { project: null, error: "Project not found" };
	}

	// A sole project is unambiguous. Never revive a stored entity reference or
	// silently select the first project from a cross-workspace list.
	const resolved = projects.length === 1 ? projects[0] : null;
	if (resolved) persistProjectId(resolved.id);
	return {
		project: resolved,
		error: projects.length > 1 ? "Select a project using its projectId." : null,
	};
}

export async function resolveProjectId<T extends ProjectIdCandidate>(
	workspaceSlug: string | undefined,
	urlHint: string | null = readUrlProjectId(),
	matches?: (project: T, hint: string) => boolean
): Promise<ResolveProjectIdResult<T>> {
	let projects: T[];
	try {
		projects = await fetchProjects<T>(workspaceSlug);
	} catch {
		return { project: null, projects: [], error: "Failed to load projects" };
	}

	const { project, error } = matchProjectId(projects, urlHint, matches);
	return { project, projects, error };
}
