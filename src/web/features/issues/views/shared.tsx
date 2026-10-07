import type { ProjectSummary, RequestScope } from "../../../server/request-context";

export function projectHref(project: ProjectSummary, path: "issues" | "epics"): string {
	return `/${path}?projectId=${encodeURIComponent(project.id)}&workspace=${encodeURIComponent(project.workspace_slug)}`;
}

export function SelectionRequired({ scope, label }: { scope: RequestScope; label: string }) {
	return (
		<section className="page-container">
			<h1>{label}</h1>
			{label === "Issues" ? (
				<>
					<p>Select a workspace to view issues across its authorized projects.</p>
					<ul>
						{scope.workspaces.map((workspace) => (
							<li key={workspace.id}>
								<a href={`/issues?workspace=${encodeURIComponent(workspace.slug)}`}>
									{workspace.name}
								</a>
							</li>
						))}
					</ul>
				</>
			) : (
				<>
					<p>
						{label === "Epics"
							? "Select a project to view epics."
							: "The issue could not be resolved in an authorized workspace. Select a project to browse its issues."}
					</p>
					<ul>
						{scope.projects.map((project) => (
							<li key={project.id}>
								<a href={projectHref(project, label === "Epics" ? "epics" : "issues")}>
									{project.workspace_name} / {project.name}
								</a>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
