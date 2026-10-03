import { useEffect, useRef, useState } from "preact/hooks";
import { useAccessGate } from "../utils/access-gate";
import { apiFetch } from "../utils/api-client";
import { usePublicViewer } from "../utils/public-viewer";
import AccessPending from "./AccessPending";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import Select from "./ui/Select";

interface Workspace {
	id: string;
	name: string;
	slug: string;
	role: string;
}

function useCreationWorkspace(workspaceSlug: string | undefined, isPublicViewer: boolean) {
	const [state, setState] = useState<{
		workspaceSlug?: string;
		workspaces: Workspace[];
		loading: boolean;
		error: string | null;
	}>({ workspaceSlug, workspaces: [], loading: true, error: null });
	const [selectedSlug, setSelectedSlug] = useState("");
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setState({ workspaceSlug, workspaces: [], loading: true, error: null });
		setSelectedSlug("");
		if (isPublicViewer) return;

		// Creation requires a workspace owner/admin, not merely a project write grant.
		// Resolve memberships even for an explicit slug so read-only users cannot create.
		apiFetch<Workspace[]>("/api/workspaces", { on401: "throw" })
			.then((data) => {
				if (cancelled) return;
				const workspaces = Array.isArray(data)
					? data.filter(
							(w) =>
								(w.role === "owner" || w.role === "admin") &&
								!!w.slug &&
								(!workspaceSlug || w.slug === workspaceSlug)
						)
					: [];
				setState({ workspaceSlug, workspaces, loading: false, error: null });
				setSelectedSlug(workspaces.length === 1 ? workspaces[0].slug : "");
			})
			.catch((error) => {
				if (!cancelled) {
					setState({ workspaceSlug, workspaces: [], loading: false, error: String(error) });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceSlug, isPublicViewer, attempt]);

	const loading = state.loading || state.workspaceSlug !== workspaceSlug;
	const workspaces = loading || isPublicViewer ? [] : state.workspaces;
	return {
		workspaces,
		loading,
		error: state.error,
		selected: workspaces.find((w) => w.slug === selectedSlug),
		select: setSelectedSlug,
		retry: () => setAttempt((prev) => prev + 1),
	};
}

interface Project {
	id: string;
	name: string;
	key: string;
	slug: string | null;
	description: string | null;
	workspace_id: string;
	workspace_name: string;
	workspace_slug: string;
	open_issue_count: number;
	backlog_issue_count: number;
	archived_at: number | null;
	created_at: number;
	updated_at: number;
}

function deriveKey(name: string): string {
	return name
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 10);
}

const KEY_BADGE_CLASS =
	"font-mono text-[0.7rem] font-medium px-1.5 py-0.5 rounded bg-surface border border-border" +
	" text-text-muted leading-6";

interface ProjectCreateFormProps {
	workspaces: Workspace[];
	workspace: Workspace | undefined;
	onWorkspaceChange: (slug: string) => void;
	nameRef: { current: HTMLInputElement | null };
	formName: string;
	onNameInput: (v: string) => void;
	formKey: string;
	onKeyInput: (v: string) => void;
	formDesc: string;
	onDescInput: (v: string) => void;
	formError: string | null;
	submitting: boolean;
	onSubmit: (e: Event) => void;
	onCancel: () => void;
}

function ProjectCreateForm({
	workspaces,
	workspace,
	onWorkspaceChange,
	nameRef,
	formName,
	onNameInput,
	formKey,
	onKeyInput,
	formDesc,
	onDescInput,
	formError,
	submitting,
	onSubmit,
	onCancel,
}: ProjectCreateFormProps) {
	return (
		<form
			onSubmit={onSubmit}
			class="bg-surface border border-border rounded-lg p-4 mb-5 flex flex-col gap-3"
		>
			<div>
				<p class="m-0 mb-1 text-xs font-semibold text-text-muted">Workspace</p>
				{workspaces.length > 1 ? (
					<Select
						ariaLabel="Workspace"
						value={workspace?.slug ?? ""}
						placeholder="Choose a workspace"
						options={workspaces.map((w) => ({ value: w.slug, label: `${w.name} (${w.slug})` }))}
						onChange={onWorkspaceChange}
						disabled={submitting}
					/>
				) : (
					<p class="m-0 text-sm text-text-muted">
						{workspace?.name} ({workspace?.slug})
					</p>
				)}
			</div>
			<div class="flex gap-3 flex-wrap">
				<Field label="Name" htmlFor="new-project-name" required class="flex-[2_1_160px] min-w-0">
					<Input
						inputRef={nameRef}
						id="new-project-name"
						type="text"
						required
						maxLength={100}
						placeholder="My Project"
						value={formName}
						onInput={(e) => onNameInput((e.target as HTMLInputElement).value)}
					/>
				</Field>
				<Field label="Key" htmlFor="new-project-key" required class="flex-[1_1_100px] min-w-0">
					<Input
						id="new-project-key"
						type="text"
						required
						maxLength={10}
						placeholder="MYPROJ"
						value={formKey}
						onInput={(e) => onKeyInput((e.target as HTMLInputElement).value.toUpperCase())}
						class="font-mono uppercase"
					/>
				</Field>
				<Field label="Description" htmlFor="new-project-desc" class="flex-[3_1_220px] min-w-0">
					<Input
						id="new-project-desc"
						type="text"
						maxLength={500}
						placeholder="Optional description"
						value={formDesc}
						onInput={(e) => onDescInput((e.target as HTMLInputElement).value)}
					/>
				</Field>
			</div>

			{formError && (
				<p role="alert" class="m-0 text-xs text-red-600">
					{formError}
				</p>
			)}

			<div class="flex gap-2 justify-end">
				<Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
					Cancel
				</Button>
				<Button type="submit" variant="primary" size="sm" disabled={submitting || !workspace}>
					{submitting ? "Creating…" : "Create project"}
				</Button>
			</div>
		</form>
	);
}

function useProjectCreateForm(workspace: Workspace | undefined, onCreated: (p: Project) => void) {
	const [formOpen, setFormOpen] = useState(false);
	const [formName, setFormName] = useState("");
	const [formKey, setFormKey] = useState("");
	const [formKeyTouched, setFormKeyTouched] = useState(false);
	const [formDesc, setFormDesc] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	// Auto-derive key from name unless the user has manually edited it
	useEffect(() => {
		if (!formKeyTouched) {
			setFormKey(deriveKey(formName));
		}
	}, [formName, formKeyTouched]);

	function open() {
		setFormName("");
		setFormKey("");
		setFormKeyTouched(false);
		setFormDesc("");
		setFormError(null);
		setFormOpen(true);
		// Focus the name input on next tick
		setTimeout(() => nameRef.current?.focus(), 0);
	}

	function close() {
		setFormOpen(false);
		setFormError(null);
	}

	function handleKeyInput(v: string) {
		setFormKey(v.toUpperCase());
		setFormKeyTouched(true);
	}

	async function submit(e: Event) {
		e.preventDefault();
		if (submitting) return;
		if (!workspace) {
			setFormError("Choose a workspace before creating a project.");
			return;
		}

		const name = formName.trim();
		const key = formKey.trim().toUpperCase();
		const description = formDesc.trim() || undefined;

		if (!name) {
			setFormError("Name is required.");
			return;
		}
		if (!key || !/^[A-Z0-9]+$/.test(key) || key.length > 10) {
			setFormError("Key must be 1–10 alphanumeric characters.");
			return;
		}

		setFormError(null);
		setSubmitting(true);

		try {
			const created = await apiFetch<{ id: string; name: string; key: string; slug: string }>(
				"/api/projects",
				{
					method: "POST",
					workspaceSlug: workspace.slug,
					body: { name, key, description },
				}
			);

			onCreated({
				id: created.id,
				name: created.name,
				key: created.key,
				slug: created.slug,
				description: description ?? null,
				archived_at: null,
				workspace_id: workspace.id,
				workspace_name: workspace.name,
				workspace_slug: workspace.slug,
				open_issue_count: 0,
				backlog_issue_count: 0,
				created_at: Math.floor(Date.now() / 1000),
				updated_at: Math.floor(Date.now() / 1000),
			});
			close();
		} catch (err) {
			setFormError(String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return {
		formOpen,
		formName,
		setFormName,
		formKey,
		formDesc,
		setFormDesc,
		submitting,
		formError,
		nameRef,
		open,
		close,
		handleKeyInput,
		submit,
	};
}

function ProjectCard({ project }: { project: Project }) {
	const open = project.open_issue_count ?? 0;
	const backlog = project.backlog_issue_count ?? 0;
	// "open" on the tile excludes backlog (API open_issue_count includes it).
	const active = open - backlog;
	const countLabel =
		open === 0
			? "No open issues"
			: backlog === 0
				? `${active} open`
				: `${active} open · ${backlog} backlog`;
	const archived = project.archived_at != null;

	return (
		<Card
			as="a"
			href={
				project.slug
					? `/projects/view/${encodeURIComponent(project.slug)}?projectId=${encodeURIComponent(project.id)}`
					: `/projects/view?projectId=${encodeURIComponent(project.id)}`
			}
			interactive
			class={`shadow-xs${archived ? " opacity-60" : ""}`}
		>
			<div class="flex items-center gap-2">
				<span class="font-bold text-text-base text-base">{project.name}</span>
				<span class={KEY_BADGE_CLASS}>{project.key}</span>
				{archived && <span class={KEY_BADGE_CLASS}>Archived</span>}
			</div>
			<span class="text-xs text-text-muted">{countLabel}</span>
			{project.description && (
				<span class="text-sm text-text-muted overflow-hidden line-clamp-2">
					{project.description}
				</span>
			)}
		</Card>
	);
}

function ProjectGrid({ projects }: { projects: Project[] }) {
	if (projects.length === 0) {
		return <EmptyState title="No projects yet." />;
	}
	return (
		<div class="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
			{projects.map((p) => (
				<ProjectCard key={p.id} project={p} />
			))}
		</div>
	);
}

export default function ProjectList({ workspaceSlug }: { workspaceSlug?: string }) {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showArchived, setShowArchived] = useState(false);

	useEffect(() => {
		setLoading(true);
		setError(null);

		const path = showArchived ? "/api/projects?includeArchived=true" : "/api/projects";
		apiFetch<Project[]>(path, { workspaceSlug })
			.then((data) => setProjects(Array.isArray(data) ? data : []))
			.catch((e) => setError(String(e)))
			.finally(() => setLoading(false));
	}, [workspaceSlug, showArchived]);

	const gate = useAccessGate(workspaceSlug);
	const isPublicViewer = usePublicViewer(workspaceSlug);
	const creationWorkspace = useCreationWorkspace(workspaceSlug, isPublicViewer);

	const createForm = useProjectCreateForm(creationWorkspace.selected, (p) =>
		setProjects((prev) => [...prev, p])
	);

	if (gate.pending) return <AccessPending />;
	if (loading) return <p aria-live="polite">Loading projects…</p>;
	if (error)
		return (
			<p role="alert" class="text-red-600">
				Failed to load projects: {error}
			</p>
		);

	return (
		<>
			<div class="flex justify-between items-center mb-4">
				<label class="flex items-center gap-1.5 text-xs text-text-muted">
					<input
						type="checkbox"
						checked={showArchived}
						onChange={(e) => setShowArchived((e.target as HTMLInputElement).checked)}
					/>
					Show archived
				</label>
				{isPublicViewer ? (
					<p class="text-xs text-text-muted m-0">
						Read-only demo — projects can't be created here.
					</p>
				) : creationWorkspace.loading ? (
					<p role="status" class="text-xs text-text-muted m-0">
						Loading workspaces…
					</p>
				) : creationWorkspace.error ? (
					<div>
						<p role="alert" class="text-xs text-red-600 m-0">
							Failed to load workspaces: {creationWorkspace.error}
						</p>
						<Button type="button" variant="outline" size="sm" onClick={creationWorkspace.retry}>
							Retry workspaces
						</Button>
					</div>
				) : creationWorkspace.workspaces.length === 0 ? (
					<p class="text-xs text-text-muted m-0">
						You need an owner or admin workspace role to create projects.
					</p>
				) : (
					!createForm.formOpen && (
						<Button type="button" variant="primary" size="sm" onClick={createForm.open}>
							+ New project
						</Button>
					)
				)}
			</div>

			{!isPublicViewer && creationWorkspace.workspaces.length > 0 && createForm.formOpen && (
				<ProjectCreateForm
					workspaces={creationWorkspace.workspaces}
					workspace={creationWorkspace.selected}
					onWorkspaceChange={creationWorkspace.select}
					nameRef={createForm.nameRef}
					formName={createForm.formName}
					onNameInput={createForm.setFormName}
					formKey={createForm.formKey}
					onKeyInput={createForm.handleKeyInput}
					formDesc={createForm.formDesc}
					onDescInput={createForm.setFormDesc}
					formError={createForm.formError}
					submitting={createForm.submitting}
					onSubmit={createForm.submit}
					onCancel={createForm.close}
				/>
			)}

			<ProjectGrid projects={projects} />
		</>
	);
}
