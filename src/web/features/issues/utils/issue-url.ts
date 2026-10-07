import { slugify } from "../lib/slugify";
/** Issue identity crosses route boundaries with explicit authorized workspace scope. */
export function issueUrl(
	projectSlug: string | null | undefined,
	issueNumber: number,
	title: string,
	fallbackId?: string,
	workspaceSlug?: string,
): string {
	const scope = workspaceSlug ? `workspace=${encodeURIComponent(workspaceSlug)}` : "";
	if (!projectSlug)
		return fallbackId
			? `/issues/view?id=${encodeURIComponent(fallbackId)}${scope ? `&${scope}` : ""}`
			: "#";
	return `/projects/${encodeURIComponent(projectSlug)}/issues/${issueNumber}/${slugify(title)}${scope ? `?${scope}` : ""}`;
}
