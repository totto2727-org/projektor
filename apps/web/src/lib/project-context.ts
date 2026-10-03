import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import {
	fetchProjects,
	matchProjectId,
	type ProjectIdCandidate,
} from "../utils/resolve-project-id";

export interface ProjectSummary extends ProjectIdCandidate {
	key: string;
	name: string;
	slug: string | null;
	workspace_slug: string;
}

export const currentProject = signal<ProjectSummary | null>(null);
export const projectsList = signal<ProjectSummary[]>([]);
export const projectError = signal<string | null>(null);
export const projectReady = signal(false);

let projectsPromise: Promise<ProjectSummary[]> | null = null;
let resolutionVersion = 0;

/** Entity `id` params on issue/wiki/feedback pages are not project identity. */
export function readProjectHint(): string | null {
	if (typeof window === "undefined") return null;
	const params = new URLSearchParams(window.location.search);
	const path = window.location.pathname;
	return (
		params.get("projectId") ||
		params.get("project") ||
		path.match(/^\/projects\/view\/([^/]+)\/?$/)?.[1] ||
		path.match(/^\/projects\/([^/]+)\/issues\/\d+\//)?.[1] ||
		(/^\/projects\/view\/?$/.test(path) ? params.get("id") : null)
	);
}

export function projectMatchesHint(project: ProjectSummary, hint: string): boolean {
	return project.id === hint || project.key === hint || project.slug === hint;
}

function loadProjects(): Promise<ProjectSummary[]> {
	if (projectsList.value.length > 0) return Promise.resolve(projectsList.value);
	if (!projectsPromise) {
		// This endpoint is global even when a workspace header is supplied.
		projectsPromise = fetchProjects<ProjectSummary>(undefined).catch(() => {
			projectsPromise = null;
			throw new Error("Failed to load projects");
		});
	}
	return projectsPromise;
}

export async function ensureProjectResolved(
	workspaceSlug: string | undefined,
	urlHint: string | null = readProjectHint(),
	matches: (project: ProjectSummary, hint: string) => boolean = projectMatchesHint
): Promise<void> {
	const version = ++resolutionVersion;
	const current = currentProject.value;
	if (
		current &&
		(!workspaceSlug || current.workspace_slug === workspaceSlug) &&
		(!urlHint || matches(current, urlHint))
	) {
		projectError.value = null;
		projectReady.value = true;
		return;
	}
	projectReady.value = false;
	currentProject.value = null;
	projectError.value = null;

	try {
		let projects = await loadProjects();
		if (version !== resolutionVersion) return;
		// A card may have just been created, or come from Show archived. Refresh
		// one time on a missing hint instead of trusting a stale active-only catalog.
		if (urlHint && !projects.some((p) => matches(p, urlHint))) {
			projects = await fetchProjects<ProjectSummary>(undefined, true);
			if (version !== resolutionVersion) return;
		}
		projectsList.value = projects;
		const scoped = workspaceSlug
			? projects.filter((p) => p.workspace_slug === workspaceSlug)
			: projects;
		const candidates = urlHint ? scoped.filter((p) => matches(p, urlHint)) : scoped;
		const { project, error } =
			candidates.length > 1
				? { project: null, error: "Select a project using its projectId." }
				: matchProjectId(candidates, urlHint, matches);
		currentProject.value = project;
		projectError.value = error;
	} catch {
		if (version !== resolutionVersion) return;
		projectError.value = "Failed to load projects";
	}
	projectReady.value = true;
}

export function __resetProjectStoreForTests(): void {
	currentProject.value = null;
	projectsList.value = [];
	projectError.value = null;
	projectReady.value = false;
	projectsPromise = null;
	resolutionVersion++;
}

export function useCurrentProject(
	workspaceSlug: string | undefined,
	urlHint: string | null = readProjectHint(),
	matches?: (project: ProjectSummary, hint: string) => boolean
) {
	useEffect(() => {
		ensureProjectResolved(workspaceSlug, urlHint, matches);
	}, [workspaceSlug, urlHint]);

	return {
		project: currentProject.value,
		projects: workspaceSlug
			? projectsList.value.filter((p) => p.workspace_slug === workspaceSlug)
			: projectsList.value,
		error: projectError.value,
		ready: projectReady.value,
	};
}
