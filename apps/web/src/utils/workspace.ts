import { currentProject, projectMatchesHint, readProjectHint } from "../lib/project-context";

// Tenant identity comes from an explicit scope or the resolved project, never a
// deployment hostname. Custom domains and subdomain routing are not equivalent.
export function resolveWorkspaceSlug(propSlug?: string): string {
	if (propSlug) return propSlug;
	if (typeof window !== "undefined") {
		const scope = new URLSearchParams(window.location.search).get("workspace");
		if (scope) return scope;
	}
	const project = currentProject.value;
	const hint = readProjectHint();
	return project && (!hint || projectMatchesHint(project, hint))
		? project.workspace_slug || ""
		: "";
}
