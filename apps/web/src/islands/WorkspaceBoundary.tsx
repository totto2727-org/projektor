import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
	currentProject,
	projectMatchesHint,
	readProjectHint,
	useCurrentProject,
} from "../lib/project-context";
import { apiFetch } from "../utils/api-client";

interface Workspace {
	slug: string;
	name: string;
}

interface Props {
	workspaceSlug?: string;
	projectHint?: string;
	children: (workspaceSlug: string) => ComponentChildren;
}

/** Projectless surfaces select a membership, never infer a tenant from a host. */
export default function WorkspaceBoundary({ workspaceSlug, children }: Props) {
	const current = currentProject.value;
	const hint = readProjectHint();
	const inherited =
		current && (!hint || projectMatchesHint(current, hint)) ? current.workspace_slug : undefined;
	const preferred = readWorkspaceHint() || inherited;
	const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const onScopeChange = () => setSelected(readWorkspaceHint() ?? null);
		document.addEventListener("projektor:workspace-change", onScopeChange);
		return () => document.removeEventListener("projektor:workspace-change", onScopeChange);
	}, []);

	useEffect(() => {
		if (workspaceSlug) return;
		let cancelled = false;
		setWorkspaces(null);
		setError(null);
		apiFetch<Workspace[]>("/api/workspaces")
			.then((list) => {
				if (!cancelled) setWorkspaces(Array.isArray(list) ? list : []);
			})
			.catch((e) => {
				if (!cancelled) setError(String(e));
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceSlug]);

	if (workspaceSlug)
		return (
			<ScopedContent key={workspaceSlug} workspaceSlug={workspaceSlug}>
				{children}
			</ScopedContent>
		);
	if (error) return <p role="alert">Failed to load workspaces: {error}</p>;
	if (!workspaces) return <p aria-live="polite">Loading workspace…</p>;
	if (workspaces.length === 0) return <p class="text-text-muted">No accessible workspace.</p>;
	const chosen = selected ?? preferred ?? "";
	const slug =
		workspaces.find((w) => w.slug === chosen)?.slug ||
		(workspaces.length === 1 && !chosen ? workspaces[0].slug : undefined);
	return (
		<>
			{workspaces.length > 1 && (
				<label class="block mb-4 text-sm text-text-muted">
					Workspace
					<select
						class="ml-2"
						value={slug ?? ""}
						onChange={(e) => setSelected(e.currentTarget.value)}
					>
						<option value="">Select a workspace</option>
						{workspaces.map((w) => (
							<option key={w.slug} value={w.slug}>
								{w.name}
							</option>
						))}
					</select>
				</label>
			)}
			{chosen && !slug && <p role="alert">Selected workspace is not accessible.</p>}
			{slug && (
				<ScopedContent key={slug} workspaceSlug={slug}>
					{children}
				</ScopedContent>
			)}
		</>
	);
}

function ScopedContent({ workspaceSlug, children }: Props & { workspaceSlug: string }) {
	useEffect(() => {
		const url = new URL(window.location.href);
		if (url.searchParams.get("workspace") === workspaceSlug) return;
		url.searchParams.set("workspace", workspaceSlug);
		history.replaceState(null, "", url.pathname + url.search + url.hash);
		document.dispatchEvent(new Event("projektor:workspace-change"));
	}, [workspaceSlug]);
	return <>{children(workspaceSlug)}</>;
}

/** Mount request-heavy islands only after project/workspace identity is known. */
export function ProjectWorkspaceBoundary({
	workspaceSlug,
	projectHint,
	requireProject = false,
	children,
}: Props & { requireProject?: boolean }) {
	const hint = projectHint || readProjectHint();
	const scope = workspaceSlug || readWorkspaceHint();
	const current = currentProject.value;
	// A caller supplying both resource identity and scope has already crossed
	// the boundary. Do not let a cached project override that explicit scope.
	if (workspaceSlug && (projectHint || !requireProject)) {
		return (
			<ScopedContent key={`${projectHint}:${workspaceSlug}`} workspaceSlug={workspaceSlug}>
				{children}
			</ScopedContent>
		);
	}
	if (!requireProject && !hint && (!current || (scope && current.workspace_slug !== scope))) {
		return <WorkspaceBoundary workspaceSlug={workspaceSlug}>{children}</WorkspaceBoundary>;
	}
	return (
		<ResolvedProjectBoundary workspaceSlug={scope} projectHint={hint ?? undefined}>
			{children}
		</ResolvedProjectBoundary>
	);
}

function readWorkspaceHint(): string | undefined {
	return typeof window === "undefined"
		? undefined
		: new URLSearchParams(window.location.search).get("workspace") || undefined;
}

function ResolvedProjectBoundary({ workspaceSlug, projectHint, children }: Props) {
	const hint = projectHint || readProjectHint();
	const { project, projects, ready, error } = useCurrentProject(workspaceSlug, hint);
	// Effects run after render. Never mount the old scope during a URL/prop switch.
	const matches =
		project &&
		(!hint || projectMatchesHint(project, hint)) &&
		(!workspaceSlug || !project.workspace_slug || project.workspace_slug === workspaceSlug);
	if (!ready || (project && !matches)) return <p aria-live="polite">Loading project…</p>;
	if (error)
		return (
			<div>
				<p role="alert">{error}</p>
				{projects.length > 0 && (
					<label class="block mb-4 text-sm text-text-muted">
						Project
						<select
							class="ml-2"
							value=""
							onChange={(e) => {
								if (!e.currentTarget.value) return;
								const url = new URL(window.location.href);
								url.searchParams.set("projectId", e.currentTarget.value);
								url.searchParams.delete("workspace");
								window.location.href = url.href;
							}}
						>
							<option value="">Select a project</option>
							{projects.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name} ({p.workspace_slug})
								</option>
							))}
						</select>
					</label>
				)}
				<a href="/">Choose a project from Projects</a>
			</div>
		);
	if (!project) return <p class="text-text-muted">No project specified.</p>;
	const slug = project.workspace_slug || workspaceSlug;
	if (!slug) return <p role="alert">The selected project has no workspace identity.</p>;
	return <div key={`${project.id}:${slug}`}>{children(slug)}</div>;
}
