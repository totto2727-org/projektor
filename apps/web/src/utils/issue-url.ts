import { slugify } from "../lib/slugify";
import { resolveWorkspaceSlug } from "./workspace";

/**
 * Build the canonical pretty URL for an issue.
 * Falls back to the UUID-based URL when projectSlug is unavailable.
 */
export function issueUrl(
	projectSlug: string | null | undefined,
	issueNumber: number,
	title: string,
	fallbackId?: string,
	workspaceSlug = resolveWorkspaceSlug()
): string {
	const scope = workspaceSlug ? `workspace=${encodeURIComponent(workspaceSlug)}` : "";
	if (!projectSlug) {
		return fallbackId ? `/issues/view?id=${fallbackId}${scope ? `&${scope}` : ""}` : "#";
	}
	return `/projects/${projectSlug}/issues/${issueNumber}/${slugify(title)}${scope ? `?${scope}` : ""}`;
}
