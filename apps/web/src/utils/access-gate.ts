import { useEffect, useState } from "preact/hooks";
import type { ProjectSummary } from "../lib/project-context";
import { apiFetch } from "./api-client";

// PROJ-315: a non-admin member with no group grants sees an empty list on every
// project-scoped surface (projects, issues, board, wiki). Rather than render a
// bare "nothing here" that reads like an empty workspace, detect the pending
// state — a non-admin caller whose visible-project set is empty — and let the
// surface swap in a friendly "access pending" panel. Admins of a genuinely empty
// workspace keep the normal empty state.
export interface AccessGate {
	loading: boolean;
	pending: boolean;
}

export function useAccessGate(workspaceSlug?: string): AccessGate {
	const [state, setState] = useState<AccessGate>({ loading: true, pending: false });

	useEffect(() => {
		let cancelled = false;
		// The global Projects page must not inherit a cached project's tenant.
		const slug = workspaceSlug;

		Promise.all([
			apiFetch<Pick<ProjectSummary, "workspace_slug">[]>("/api/projects", { workspaceSlug }),
			slug
				? apiFetch<{ currentUserRole?: string }>(`/api/workspaces/${slug}`, {
						workspaceSlug: slug,
					})
				: Promise.resolve({ currentUserRole: undefined }),
		])
			.then(([projects, ws]) => {
				if (cancelled) return;
				const role = ws?.currentUserRole;
				const isAdmin = role === "owner" || role === "admin";
				const visible = Array.isArray(projects)
					? projects.filter((p) => !slug || p.workspace_slug === slug)
					: [];
				const noProjects = visible.length === 0;
				// Only claim "pending" when we positively know a non-admin role: an
				// unresolved role (missing slug, request failure) fails open to the
				// surface's own empty state rather than a misleading pending panel.
				setState({ loading: false, pending: !!role && !isAdmin && noProjects });
			})
			.catch(() => {
				if (!cancelled) setState({ loading: false, pending: false });
			});

		return () => {
			cancelled = true;
		};
	}, [workspaceSlug]);

	return state;
}
