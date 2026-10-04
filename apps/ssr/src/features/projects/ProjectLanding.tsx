"use client";

import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useActionState, useEffect, useState } from "react";
import { unwrapResult } from "../../client/functions";
import { useRuntime } from "../../client/runtime";
import { FormErrors } from "../../components/FormErrors";
import { Button } from "../../components/ui/Button";
import { formatTimestampDate } from "../timestamp";
import { archiveProject, updateDescription } from "./actions";
import { ProjectFlowCharts } from "./ProjectFlowCharts";
import {
	type FlowMetrics,
	type Project,
	type RecentIssue,
	type RecentWikiPage,
	UpdateDescriptionInputSchema,
} from "./schemas";

const colors: Record<string, string> = {
	todo: "var(--status-todo)",
	in_progress: "var(--status-in-progress)",
	in_review: "var(--status-in-review)",
	done: "var(--status-done)",
	cancelled: "var(--status-cancelled)",
};
const heading = "text-xs font-semibold text-text-muted m-0 mb-3 uppercase tracking-[0.05em]";
const badge =
	"font-mono text-xs font-medium px-2 py-[0.125rem] rounded bg-surface border border-border text-text-muted";
const date = formatTimestampDate;

export function ProjectLanding({
	initialProject,
	initialIssues,
	initialWiki,
	initialFlow,
	workspaceSlug,
	canEdit,
}: {
	initialProject: Project;
	initialIssues: readonly RecentIssue[];
	initialWiki: readonly RecentWikiPage[];
	initialFlow: FlowMetrics | null;
	workspaceSlug: string;
	canEdit: boolean;
}) {
	const runtime = useRuntime();
	const project = initialProject;
	const [editing, setEditing] = useState(false);
	const [result, formAction, pending] = useActionState(updateDescription, null);
	const [archiveBusy, setArchiveBusy] = useState(false);
	const [requestError, setRequestError] = useState<string | null>(null);
	const isPublicViewer = runtime.scope?.user.email === "public-viewer@projektor.local";
	const canMutate = canEdit && !isPublicViewer;
	const effectiveSlug =
		runtime.scope?.selection.kind === "project"
			? runtime.scope.selection.workspace.slug
			: workspaceSlug;
	const form = useForm({
		defaultValues: {
			workspaceSlug: effectiveSlug,
			projectId: initialProject.id,
			description: initialProject.description ?? "",
		},
		validators: {
			onChange: Schema.toStandardSchemaV1(UpdateDescriptionInputSchema),
			onSubmit: Schema.toStandardSchemaV1(UpdateDescriptionInputSchema),
		},
	});

	useEffect(() => {
		if (result?.ok) setEditing(false);
	}, [result]);

	async function toggleArchived() {
		setArchiveBusy(true);
		setRequestError(null);
		const archived = project.archivedAt == null;
		try {
			await unwrapResult(
				await archiveProject({ workspaceSlug: effectiveSlug, projectId: project.id, archived })
			);
		} catch (cause) {
			setRequestError(`Save failed: ${cause instanceof Error ? cause.message : "Unknown error"}`);
		} finally {
			setArchiveBusy(false);
		}
	}

	function startEditing() {
		setRequestError(null);
		form.reset({
			workspaceSlug: effectiveSlug,
			projectId: project.id,
			description: project.description ?? "",
		});
		setEditing(true);
	}

	return (
		<div className="page-container">
			<header className="mb-6">
				<nav className="text-sm text-text-muted mb-2">
					<a
						href={`/?workspace=${encodeURIComponent(effectiveSlug)}`}
						className="text-text-muted no-underline"
					>
						Projects
					</a>
					<span className="mx-[0.375rem]">/</span>
					{project.name}
				</nav>
				<div className="flex items-center gap-3 mb-2">
					<h1 className="m-0 text-2xl font-bold text-text-base">{project.name}</h1>
					<span className={badge}>{project.key}</span>
					{project.archivedAt != null && <span className={badge}>Archived</span>}
					{canMutate && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => void toggleArchived()}
							disabled={archiveBusy || pending}
						>
							{project.archivedAt != null ? "Unarchive" : "Archive"}
						</Button>
					)}
				</div>
				<div className="max-w-[640px]">
					{editing ? (
						<form
							action={formAction}
							onSubmit={(event) => {
								if (!form.state.canSubmit) event.preventDefault();
							}}
						>
							<input type="hidden" name="workspaceSlug" value={effectiveSlug} />
							<input type="hidden" name="projectId" value={project.id} />
							<form.Field name="description">
								{(field) => (
									<textarea
										name="description"
										value={field.state.value}
										rows={3}
										maxLength={500}
										aria-label="Project description"
										className="w-full px-3 py-2 border border-border rounded text-sm bg-bg text-text-base font-[inherit] leading-[1.5] resize-y"
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.currentTarget.value)}
									/>
								)}
							</form.Field>
							<FormErrors errors={form.state.errors} className="my-1" />
							{result && !result.ok && (
								<p role="alert" className="text-danger-text text-[0.8rem] my-1">
									{result.message}
								</p>
							)}
							{requestError && (
								<p role="alert" className="text-danger-text text-[0.8rem] my-1">
									{requestError}
								</p>
							)}
							<form.Subscribe selector={(state) => state.canSubmit}>
								{(canSubmit) => (
									<div className="flex gap-2 mt-2">
										<Button
											type="submit"
											variant="primary"
											size="sm"
											disabled={pending || !canSubmit}
										>
											{pending ? "Saving…" : "Save"}
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => {
												setEditing(false);
												form.reset({
													workspaceSlug: effectiveSlug,
													projectId: project.id,
													description: project.description ?? "",
												});
											}}
											disabled={pending}
										>
											Cancel
										</Button>
									</div>
								)}
							</form.Subscribe>
						</form>
					) : canMutate ? (
						<button
							type="button"
							className="w-full text-left bg-transparent cursor-pointer px-2 py-[0.375rem] rounded border border-transparent hover:border-border hover:bg-surface"
							onClick={startEditing}
							title="Click to edit description"
							aria-label="Edit project description"
						>
							<span
								className={`block text-sm text-text-muted whitespace-pre-wrap${project.description ? "" : " italic"}`}
							>
								{project.description ?? "Add a project description…"}
							</span>
						</button>
					) : (
						<p className="m-0 px-2 py-[0.375rem] text-sm text-text-muted whitespace-pre-wrap">
							{project.description ?? "No description."}
						</p>
					)}
					{requestError && !editing && (
						<p role="alert" className="text-danger-text text-[0.8rem] my-1">
							{requestError}
						</p>
					)}
				</div>
			</header>
			<ProjectFlowCharts flow={initialFlow} />
			<section className="mb-8" aria-labelledby="recent-issues-heading">
				<h2 id="recent-issues-heading" className={heading}>
					Recent Issues
				</h2>
				{initialIssues.length === 0 ? (
					<p className="text-text-muted text-sm py-2">No issues yet.</p>
				) : (
					<div>
						{initialIssues.map((issue) => (
							<div
								key={issue.id}
								className="flex items-baseline gap-2 py-2 border-b border-border last:border-b-0"
							>
								<span className="font-mono text-xs text-text-muted shrink-0">
									{issue.project_key ? `${issue.project_key}-${issue.number}` : `#${issue.number}`}
								</span>
								<span
									className="text-[0.8rem] font-medium shrink-0 min-w-[4rem]"
									style={{ color: colors[issue.status_category ?? ""] ?? "var(--text-muted)" }}
								>
									{issue.status_name ?? issue.status_key ?? "Unscheduled"}
								</span>
								<a
									href={`/issues/view?id=${encodeURIComponent(issue.id)}&projectId=${encodeURIComponent(project.id)}&workspace=${encodeURIComponent(effectiveSlug)}`}
									className="text-text-base no-underline text-sm flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap hover:underline"
								>
									{issue.title}
								</a>
								<span className="text-xs text-text-muted shrink-0">{date(issue.updated_at)}</span>
							</div>
						))}
					</div>
				)}
			</section>
			<section className="mb-8" aria-labelledby="recent-wiki-heading">
				<h2 id="recent-wiki-heading" className={heading}>
					Recent Wiki Pages
				</h2>
				{initialWiki.length === 0 ? (
					<p className="text-text-muted text-sm py-2">No wiki pages yet.</p>
				) : (
					<div>
						{initialWiki.map((page) => (
							<div key={page.id} className="py-2 border-b border-border last:border-b-0">
								<div className="flex justify-between items-baseline gap-2">
									<a
										href={`/wiki/${encodeURIComponent(page.slug)}?projectId=${encodeURIComponent(project.id)}&workspace=${encodeURIComponent(effectiveSlug)}`}
										className="text-text-base no-underline text-sm hover:underline"
									>
										{page.title}
									</a>
									<span className="text-xs text-text-muted shrink-0">{date(page.updated_at)}</span>
								</div>
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
