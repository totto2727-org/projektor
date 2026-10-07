"use client";
import { Schema } from "effect";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Input } from "../../../components/ui/Input";
import Select from "../../../components/ui/Select";
import { createIssue } from "../actions";
import { Priority, RequiredText, TitleText, useIssueForm } from "../forms";
import { statusDisplayName } from "../lib/status";
import { issueUrl } from "../utils/issue-url";
import { PRIORITY_OPTIONS } from "../utils/issue-utils";
import { useUnsavedUnloadGuard } from "../utils/use-unsaved-unload-guard";
import type { EpicsInitialData } from "../views/EpicsPage";
import {
	CATEGORY_COLORS,
	type Issue,
	type ProjectLookup as ProjectMeta,
	type SortKey,
	sortIssues,
	type TaskStatus,
} from "./board-utils";
import type { DateField } from "./issue-list/FiltersPopover";
import FiltersPopover from "./issue-list/FiltersPopover";
import { useIssueFilters } from "./issue-list/useIssueFilters";

type EpicRollup = { done: number; remaining: number; total: number };

// PROJ-441: rollup is attached server-side per item when includeRollups=1 is passed —
// see the /api/issues fetch in useEpicsData below.
type EpicItem = Issue & { rollup?: EpicRollup };

const PRIORITY_LABEL: Record<string, string> = {
	urgent: "Urgent",
	high: "High",
	medium: "Medium",
	low: "Low",
	none: "None",
};

const TH_CLASS =
	"text-left px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-[0.05em] border-b-2 border-border";
const CELL_CLASS =
	"px-3 py-[0.625rem] border-b border-border align-middle group-hover:bg-surface [tr:last-child_&]:border-b-0";
// CD-294: the panel had no max-height and no scroll region, so inside the
// `fixed inset-0` backdrop (bottom-anchored on phones) anything taller than the
// visual viewport overflowed off the top with no way to scroll to it — the Title
// field first. `dvh`, not `vh`: iOS never shrinks `vh` for the keyboard or an
// expanded URL bar, which is exactly when this panel runs out of room.
const MODAL_CLASS =
	"bg-bg border border-border rounded-lg p-6 w-full max-w-[480px] mx-4 " +
	"max-h-[80dvh] overflow-y-auto overscroll-contain " +
	"max-sm:rounded-t-lg max-sm:rounded-b-none max-sm:mx-0 max-sm:max-h-[90dvh]";

function defaultCreateProjectId(
	projectId: string | null,
	projects: readonly ProjectMeta[],
): string {
	if (projectId) return projects.find((p) => p.id === projectId)?.id ?? projects[0]?.id ?? "";
	return projects[0]?.id ?? "";
}

function computeDerivedStatuses(epics: readonly Issue[]): TaskStatus[] {
	const derived: TaskStatus[] = [];
	const seen = new Set<string>();
	for (const ep of epics) {
		if (ep.status_id && !seen.has(ep.status_id)) {
			seen.add(ep.status_id);
			derived.push({
				id: ep.status_id,
				key: ep.status_key ?? ep.status_id,
				name: ep.status_name ?? ep.status_key ?? ep.status_id,
				category: ep.status_category ?? "",
				color: null,
			});
		}
	}
	return derived;
}

function sortIndicator(key: SortKey, sortBy: SortKey, sortDir: "asc" | "desc") {
	if (sortBy !== key) return null;
	return <span className="ml-1 opacity-60">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

interface EpicListHeaderProps {
	derivedStatuses: TaskStatus[];
	filterStatuses: string[];
	setFilterStatuses: (v: string[] | ((prev: string[]) => string[])) => void;
	filterPriorities: string[];
	setFilterPriorities: (v: string[] | ((prev: string[]) => string[])) => void;
	filterDateField: DateField;
	setFilterDateField: (v: DateField | ((prev: DateField) => DateField)) => void;
	filterDateFrom: string;
	setFilterDateFrom: (v: string | ((prev: string) => string)) => void;
	filterDateTo: string;
	setFilterDateTo: (v: string | ((prev: string) => string)) => void;
	epicTypeId: string | null;
	onOpenCreate: () => void;
}

function EpicListHeader(props: EpicListHeaderProps) {
	return (
		<div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
			<FiltersPopover
				derivedStatuses={props.derivedStatuses}
				filterStatuses={props.filterStatuses}
				setFilterStatuses={props.setFilterStatuses}
				filterPriorities={props.filterPriorities}
				setFilterPriorities={props.setFilterPriorities}
				filterDateField={props.filterDateField}
				setFilterDateField={props.setFilterDateField}
				filterDateFrom={props.filterDateFrom}
				setFilterDateFrom={props.setFilterDateFrom}
				filterDateTo={props.filterDateTo}
				setFilterDateTo={props.setFilterDateTo}
				isSearchActive={false}
			/>
			{props.epicTypeId && (
				<Button variant="primary" size="sm" onClick={props.onOpenCreate}>
					+ New Epic
				</Button>
			)}
		</div>
	);
}

function useCreateEpicForm(
	projectId: string | null,
	projects: readonly ProjectMeta[],
	epicTypeId: string | null,
) {
	const [showCreate, setShowCreate] = useState(false);
	const createForm = useIssueForm(
		{ createTitle: "", createProjectId: "", createPriority: "medium" },
		Schema.Struct({
			createTitle: TitleText,
			createProjectId: RequiredText,
			createPriority: Priority,
		}),
	);
	const [createTitle, setCreateTitle] = createForm.field("createTitle");
	const [createProjectId, setCreateProjectId] = createForm.field("createProjectId");
	const [createPriority, setCreatePriority] = createForm.field("createPriority");
	const [result, submitCreate, submitting] = useActionState(createIssue, null);
	const openedResult = useRef(result);
	const createError =
		result && result !== openedResult.current && !result.ok
			? `Failed to create epic: ${result.message}`
			: null;
	useEffect(() => {
		if (result?.ok) setShowCreate(false);
	}, [result]);
	useUnsavedUnloadGuard(showCreate && Boolean(createTitle.trim()));

	function openCreate() {
		setCreateProjectId(defaultCreateProjectId(projectId, projects));
		setCreateTitle("");
		setCreatePriority("medium");
		openedResult.current = result;
		setShowCreate(true);
	}

	return {
		showCreate,
		setShowCreate,
		createTitle,
		setCreateTitle,
		createProjectId,
		setCreateProjectId,
		createPriority,
		setCreatePriority,
		submitting,
		createValid: createForm.isValid && epicTypeId !== null,
		createError,
		openCreate,
		submitCreate,
	};
}

export default function EpicList({
	workspaceSlug,
	initialData,
}: {
	workspaceSlug: string;
	initialData: EpicsInitialData;
}) {
	const {
		filterStatuses,
		setFilterStatuses,
		filterPriorities,
		setFilterPriorities,
		filterDateField,
		setFilterDateField,
		filterDateFrom,
		setFilterDateFrom,
		filterDateTo,
		setFilterDateTo,
	} = useIssueFilters(initialData.search, initialData.project.key, initialData.projects);

	const projectId = initialData.project.id;
	const projects = initialData.projects;
	const epicTypeId = initialData.taskTypes.find((entry) => entry.key === "epic")?.id ?? null;

	const [sortBy, setSortBy] = useState<SortKey>("created_at");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

	const epics: EpicItem[] = initialData.page.items;

	const {
		showCreate,
		setShowCreate,
		createTitle,
		setCreateTitle,
		createProjectId,
		setCreateProjectId,
		createPriority,
		setCreatePriority,
		submitting,
		createValid,
		createError,
		openCreate,
		submitCreate,
	} = useCreateEpicForm(projectId, projects, epicTypeId);

	function toggleSort(key: SortKey) {
		if (sortBy === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(key);
			setSortDir("asc");
		}
	}

	const filteredEpics = epics;
	const derivedStatuses = computeDerivedStatuses(epics);

	return (
		<div>
			<EpicListHeader
				derivedStatuses={derivedStatuses}
				filterStatuses={filterStatuses}
				setFilterStatuses={setFilterStatuses}
				filterPriorities={filterPriorities}
				setFilterPriorities={setFilterPriorities}
				filterDateField={filterDateField}
				setFilterDateField={setFilterDateField}
				filterDateFrom={filterDateFrom}
				setFilterDateFrom={setFilterDateFrom}
				filterDateTo={filterDateTo}
				setFilterDateTo={setFilterDateTo}
				epicTypeId={epicTypeId}
				onOpenCreate={openCreate}
			/>

			<EpicsTable
				epics={epics}
				filteredEpics={filteredEpics}
				sortBy={sortBy}
				sortDir={sortDir}
				toggleSort={toggleSort}
			/>

			<CreateEpicModal
				showCreate={showCreate}
				setShowCreate={setShowCreate}
				createTitle={createTitle}
				setCreateTitle={setCreateTitle}
				createProjectId={createProjectId}
				setCreateProjectId={setCreateProjectId}
				createPriority={createPriority}
				setCreatePriority={setCreatePriority}
				submitting={submitting}
				createError={createError}
				createValid={createValid}
				workspaceSlug={workspaceSlug}
				epicTypeId={epicTypeId}
				projects={projects}
				submitCreate={submitCreate}
			/>
		</div>
	);
}

interface EpicsTableProps {
	epics: EpicItem[];
	filteredEpics: EpicItem[];
	sortBy: SortKey;
	sortDir: "asc" | "desc";
	toggleSort: (key: SortKey) => void;
}

function EpicsTable({ epics, filteredEpics, sortBy, sortDir, toggleSort }: EpicsTableProps) {
	if (epics.length === 0) {
		return <EmptyState title="No epics found. Use the button above to create one." />;
	}
	if (filteredEpics.length === 0) {
		return <EmptyState title="No epics match the active filters." />;
	}
	// sortIssues' signature is Issue[] => Issue[]; the sort is a pure reorder, so the
	// rollup field carried by EpicItem survives — safe to cast back.
	const sorted = sortIssues(filteredEpics, sortBy, sortDir) as EpicItem[];
	return (
		<>
			<div className="overflow-x-auto max-sm:hidden">
				<table className="w-full border-collapse text-sm" aria-label="Epics">
					<thead>
						<tr>
							<th className={TH_CLASS}>Title</th>
							<th className={TH_CLASS}>Status</th>
							<th
								className={`${TH_CLASS} cursor-pointer select-none hover:text-text-base`}
								onClick={() => toggleSort("priority")}
							>
								Priority{sortIndicator("priority", sortBy, sortDir)}
							</th>
							<th className={TH_CLASS}>Children</th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((ep) => (
							<EpicRow key={ep.id} ep={ep} rollup={ep.rollup} />
						))}
					</tbody>
				</table>
			</div>
			<div className="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
				{sorted.map((ep) => (
					<EpicMobileCard key={ep.id} ep={ep} rollup={ep.rollup} />
				))}
			</div>
		</>
	);
}

function EpicMobileCard({ ep, rollup }: EpicRowProps) {
	const statusColor = CATEGORY_COLORS[ep.status_category ?? ""] ?? "var(--text-muted)";
	return (
		<Card>
			<a
				href={issueUrl(ep.project_key, ep.number, ep.title, ep.id, ep.workspaceSlug)}
				className="text-text-base no-underline font-medium hover:underline"
			>
				{ep.title}
			</a>
			<div className="flex justify-between items-center gap-2">
				<span className="font-medium text-[0.8rem]" style={{ color: statusColor }}>
					{statusDisplayName(ep.status_name, ep.status_key)}
				</span>
				<span className="text-xs font-medium">{PRIORITY_LABEL[ep.priority] ?? ep.priority}</span>
			</div>
			<div className="text-xs text-text-muted">
				{!rollup || rollup.total === 0
					? "—"
					: `${rollup.done} done · ${rollup.remaining} remaining`}
			</div>
		</Card>
	);
}

interface EpicRowProps {
	ep: Issue;
	rollup: EpicRollup | undefined;
}

function EpicRow({ ep, rollup }: EpicRowProps) {
	const statusColor = CATEGORY_COLORS[ep.status_category ?? ""] ?? "var(--text-muted)";
	return (
		<tr className="group">
			<td className={CELL_CLASS}>
				<a
					href={issueUrl(ep.project_key, ep.number, ep.title, ep.id, ep.workspaceSlug)}
					className="text-text-base no-underline font-medium hover:underline"
				>
					{ep.title}
				</a>
			</td>
			<td className={CELL_CLASS}>
				<span className="font-medium text-[0.8rem]" style={{ color: statusColor }}>
					{statusDisplayName(ep.status_name, ep.status_key)}
				</span>
			</td>
			<td className={CELL_CLASS}>
				<span className="inline-flex items-center px-[0.45rem] py-[0.1rem] rounded-[3px] text-xs font-medium">
					{PRIORITY_LABEL[ep.priority] ?? ep.priority}
				</span>
			</td>
			<td className={CELL_CLASS}>
				{!rollup || rollup.total === 0 ? (
					<span className="font-mono text-xs text-text-muted">—</span>
				) : (
					<span className="text-xs text-text-muted">
						{rollup.done} done · {rollup.remaining} remaining
					</span>
				)}
			</td>
		</tr>
	);
}

interface CreateEpicModalProps {
	showCreate: boolean;
	setShowCreate: (v: boolean) => void;
	createTitle: string;
	setCreateTitle: (v: string) => void;
	createProjectId: string;
	setCreateProjectId: (v: string) => void;
	createPriority: string;
	setCreatePriority: (v: string) => void;
	submitting: boolean;
	createError: string | null;
	projects: readonly ProjectMeta[];
	createValid: boolean;
	workspaceSlug?: string;
	epicTypeId: string | null;
	submitCreate: (formData: FormData) => void;
}

function CreateEpicModal({
	showCreate,
	setShowCreate,
	createTitle,
	setCreateTitle,
	createProjectId,
	setCreateProjectId,
	createPriority,
	setCreatePriority,
	submitting,
	createError,
	projects,
	createValid,
	workspaceSlug,
	epicTypeId,
	submitCreate,
}: CreateEpicModalProps) {
	if (!showCreate) return null;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes on click; Escape on the dialog covers keyboard
		// biome-ignore lint/a11y/useKeyWithClickEvents: backdrop closes on click; Escape on the dialog covers keyboard
		<div
			// CD-294: above the topbar (z-index: 110), below popovers (200).
			className="fixed inset-0 z-[120] flex items-start justify-center pt-12 bg-black/40 max-sm:items-end max-sm:pt-0"
			onClick={(e) => {
				if (e.target === e.currentTarget) setShowCreate(false);
			}}
		>
			<div className={MODAL_CLASS} role="dialog" aria-modal="true" aria-label="Create new epic">
				<h2 className="mb-5 text-lg font-bold text-text-base">New Epic</h2>

				{createError && (
					<p role="alert" className="text-danger-text mb-3 text-sm">
						{createError}
					</p>
				)}

				<form action={submitCreate}>
					{workspaceSlug && <input type="hidden" name="workspaceSlug" value={workspaceSlug} />}
					<input type="hidden" name="projectId" value={createProjectId} />
					<input type="hidden" name="priority" value={createPriority} />
					{epicTypeId && <input type="hidden" name="typeId" value={epicTypeId} />}
					<div className="mb-[0.875rem]">
						<label
							htmlFor="create-epic-title"
							className="block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]"
						>
							Title *
						</label>
						<Input
							id="create-epic-title"
							name="title"
							maxLength={500}
							type="text"
							value={createTitle}
							onInput={(e) => setCreateTitle((e.target as HTMLInputElement).value)}
							placeholder="Epic title"
							required
							autoFocus
						/>
					</div>

					<div className="flex gap-3 mb-5 flex-wrap items-end">
						{projects.length > 1 && (
							<div>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: Select uses ariaLabel for accessibility */}
								<label className="block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]">
									Project
								</label>
								<Select
									ariaLabel="Select project"
									value={createProjectId}
									onChange={setCreateProjectId}
									options={projects.map((p) => ({ value: p.id, label: p.name }))}
								/>
							</div>
						)}

						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: Select uses ariaLabel for accessibility */}
							<label className="block text-[0.78rem] font-semibold text-text-muted mb-[0.3rem] uppercase tracking-[0.04em]">
								Priority
							</label>
							<Select
								ariaLabel="Select priority"
								value={createPriority}
								onChange={setCreatePriority}
								capitalize
								options={PRIORITY_OPTIONS}
								buttonStyle={{
									background: `var(--priority-${createPriority}-bg, var(--priority-low-bg))`,
									color: `var(--priority-${createPriority}-text, var(--text-muted))`,
									fontWeight: 500,
									borderColor: "transparent",
								}}
							/>
						</div>
					</div>

					<div className="flex gap-2">
						<Button type="submit" variant="primary" disabled={submitting || !createValid}>
							{submitting ? "Creating…" : "Create Epic"}
						</Button>
						<Button variant="outline" onClick={() => setShowCreate(false)}>
							Cancel
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
