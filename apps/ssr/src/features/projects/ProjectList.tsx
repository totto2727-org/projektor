"use client";

import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useActionState, useEffect, useRef } from "react";
import { useRuntime } from "../../client/runtime";
import { FormErrors } from "../../components/FormErrors";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { createProject } from "./actions";
import { CreateProjectInputSchema, type ProjectSummary } from "./schemas";

type Membership = {
	id: string;
	name: string;
	slug: string;
	role: "owner" | "admin" | "member" | "viewer";
};
const badgeClass =
	"font-mono text-[0.7rem] font-medium px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted leading-6";
const deriveKey = (name: string) =>
	name
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 10);

function ProjectTile({ project }: { project: ProjectSummary }) {
	const open = project.open_issue_count;
	const backlog = project.backlog_issue_count;
	const active = open - backlog;
	const count =
		open === 0
			? "No open issues"
			: backlog === 0
				? `${active} open`
				: `${active} open · ${backlog} backlog`;
	const path = project.slug
		? `/projects/view/${encodeURIComponent(project.slug)}`
		: "/projects/view";
	return (
		<Card interactive className={`shadow-xs${project.archived_at != null ? " opacity-60" : ""}`}>
			<a
				href={`${path}?${new URLSearchParams({ projectId: project.id, workspace: project.workspace_slug })}`}
				className="block no-underline"
			>
				<div className="flex items-center gap-2">
					<span className="font-bold text-text-base text-base">{project.name}</span>
					<span className={badgeClass}>{project.key}</span>
					{project.archived_at != null && <span className={badgeClass}>Archived</span>}
				</div>
				<span className="text-xs text-text-muted">{count}</span>
				{project.description && (
					<span className="text-sm text-text-muted overflow-hidden line-clamp-2">
						{project.description}
					</span>
				)}
			</a>
		</Card>
	);
}

export function ProjectList({
	initialProjects,
	memberships,
	showArchived = false,
}: {
	initialProjects: readonly ProjectSummary[];
	memberships: readonly Membership[];
	showArchived?: boolean;
}) {
	const runtime = useRuntime();
	const url = new URL(runtime.url);
	const disclosure = useRef<HTMLDetailsElement>(null);
	const [result, formAction, pending] = useActionState(createProject, null);
	const isPublicViewer = runtime.scope?.user.email === "public-viewer@projektor.local";
	const selectedWorkspace =
		runtime.scope?.selection.kind === "workspace" ? runtime.scope.selection.workspace : null;
	const accessPending =
		!!selectedWorkspace &&
		(selectedWorkspace.role === "member" || selectedWorkspace.role === "viewer") &&
		!initialProjects.some((project) => project.workspace_slug === selectedWorkspace.slug);
	const writable = isPublicViewer
		? []
		: memberships.filter(
				(item) =>
					(item.role === "owner" || item.role === "admin") &&
					(!selectedWorkspace || item.slug === selectedWorkspace.slug)
			);
	const form = useForm({
		defaultValues: {
			workspaceSlug: writable.length === 1 ? writable[0].slug : "",
			name: "",
			key: "",
			description: "",
		},
		validators: {
			onChange: Schema.toStandardSchemaV1(CreateProjectInputSchema),
			onSubmit: Schema.toStandardSchemaV1(CreateProjectInputSchema),
		},
	});
	useEffect(() => {
		if (result?.ok && disclosure.current) disclosure.current.open = false;
	}, [result]);
	if (accessPending)
		return (
			<div
				role="status"
				className="flex flex-col items-center gap-3 text-center max-w-md mx-auto py-16 px-6"
			>
				<div
					aria-hidden="true"
					className="flex items-center justify-center w-12 h-12 rounded-full bg-surface border border-border text-2xl"
				>
					🔒
				</div>
				<h2 className="m-0 text-lg font-semibold text-text-base">Access pending</h2>
				<p className="m-0 text-sm text-text-muted">
					You’re not a member of any project group yet. Once a workspace admin adds you to a group,
					the projects, issues, and wiki pages you can access will appear here.
				</p>
			</div>
		);
	return (
		<>
			<div className="flex justify-between items-center mb-4">
				<form method="get" action={url.pathname} className="flex items-center gap-2">
					{[...url.searchParams]
						.filter(([name]) => name !== "includeArchived")
						.map(([name, value]) => (
							<input key={`${name}:${value}`} type="hidden" name={name} value={value} />
						))}
					<label className="flex items-center gap-1.5 text-xs text-text-muted">
						<input
							type="checkbox"
							name="includeArchived"
							value="true"
							defaultChecked={showArchived}
							onChange={(event) => event.currentTarget.form?.requestSubmit()}
						/>
						Show archived
					</label>
					<Button type="submit" variant="outline" size="sm">
						Apply
					</Button>
				</form>
				{isPublicViewer ? (
					<p className="text-xs text-text-muted m-0">
						Read-only demo — projects can't be created here.
					</p>
				) : (
					writable.length === 0 && (
						<p className="text-xs text-text-muted m-0">
							You need an owner or admin workspace role to create projects.
						</p>
					)
				)}
			</div>
			{writable.length > 0 && (
				<details ref={disclosure} className="mb-5">
					<summary className="btn btn-primary text-xs w-fit ml-auto cursor-pointer">
						+ New project
					</summary>
					<form
						action={formAction}
						onSubmit={(event) => {
							if (!form.state.canSubmit) event.preventDefault();
						}}
						className="bg-surface border border-border rounded-lg p-4 mt-3 flex flex-col gap-3"
					>
						<div>
							<p className="m-0 mb-1 text-xs font-semibold text-text-muted">Workspace</p>
							<form.Field name="workspaceSlug">
								{(field) =>
									writable.length > 1 ? (
										<select
											name="workspaceSlug"
											required
											aria-label="Workspace"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.currentTarget.value)}
											onBlur={field.handleBlur}
											disabled={pending}
										>
											<option value="">Choose a workspace</option>
											{writable.map((item) => (
												<option key={item.id} value={item.slug}>
													{item.name} ({item.slug})
												</option>
											))}
										</select>
									) : (
										<>
											<input type="hidden" name="workspaceSlug" value={field.state.value} />
											<p className="m-0 text-sm text-text-muted">
												{writable[0]?.name} ({writable[0]?.slug})
											</p>
										</>
									)
								}
							</form.Field>
						</div>
						<div className="flex gap-3 flex-wrap">
							<form.Field name="name">
								{(field) => (
									<label className="flex-[2_1_160px] min-w-0">
										Name
										<input
											name="name"
											required
											maxLength={100}
											placeholder="My Project"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => {
												const value = event.currentTarget.value;
												field.handleChange(value);
												if (!form.getFieldMeta("key")?.isTouched)
													form.setFieldValue("key", deriveKey(value));
											}}
										/>
									</label>
								)}
							</form.Field>
							<form.Field name="key">
								{(field) => (
									<label className="flex-[1_1_100px] min-w-0">
										Key
										<input
											name="key"
											required
											maxLength={10}
											placeholder="MYPROJ"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.currentTarget.value.toUpperCase())
											}
										/>
									</label>
								)}
							</form.Field>
							<form.Field name="description">
								{(field) => (
									<label className="flex-[3_1_220px] min-w-0">
										Description
										<input
											name="description"
											maxLength={500}
											placeholder="Optional description"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.currentTarget.value)}
										/>
									</label>
								)}
							</form.Field>
						</div>
						<FormErrors errors={form.state.errors} className="m-0 text-red-600" />
						{result && !result.ok && (
							<p role="alert" className="m-0 text-xs text-red-600">
								{result.message}
							</p>
						)}
						<form.Subscribe selector={(state) => state.canSubmit}>
							{(canSubmit) => (
								<div className="flex gap-2 justify-end">
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => {
											if (disclosure.current) disclosure.current.open = false;
										}}
										disabled={pending}
									>
										Cancel
									</Button>
									<Button
										type="submit"
										variant="primary"
										size="sm"
										disabled={pending || !canSubmit}
									>
										{pending ? "Creating…" : "Create project"}
									</Button>
								</div>
							)}
						</form.Subscribe>
					</form>
				</details>
			)}
			{initialProjects.length === 0 ? (
				<EmptyState title="No projects yet." />
			) : (
				<div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
					{initialProjects.map((project) => (
						<ProjectTile key={project.id} project={project} />
					))}
				</div>
			)}
		</>
	);
}
