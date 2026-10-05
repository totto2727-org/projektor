"use client";
import { createContext, type ReactNode, useContext, useState } from "react";
import { unwrapResult } from "../../../../client/functions";
import { Button } from "../../../../components/ui/Button";
import Select from "../../../../components/ui/Select";
import { updateIssue } from "../../actions";
import type { Issue, TaskStatus } from "../board-utils";

const Selection = createContext<{
	selected: ReadonlySet<string>;
	toggle: (id: string, checked: boolean) => void;
} | null>(null);
export function IssueSelectionControl({
	issue,
}: {
	issue: Pick<Issue, "id" | "number" | "project_key" | "title">;
}) {
	const selection = useContext(Selection);
	if (!selection) return null;
	return (
		<input
			type="checkbox"
			aria-label={`Select ${issue.project_key ?? "issue"}-${issue.number}`}
			checked={selection.selected.has(issue.id)}
			onChange={(event) => selection.toggle(issue.id, event.currentTarget.checked)}
			className="mr-2 accent-accent"
		/>
	);
}
export function IssueBulkProvider({
	children,
	issues,
	statuses,
	workspaceSlug,
}: {
	children: ReactNode;
	issues: readonly Issue[];
	statuses: readonly TaskStatus[];
	workspaceSlug: string;
}) {
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	function toggle(id: string, checked: boolean) {
		setSelected((current) => {
			const next = new Set(current);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	}
	async function change(changes: { statusId: string } | { priority: string }) {
		const ids = [...selected];
		setBusy(true);
		setError(null);
		try {
			for (const id of ids)
				unwrapResult(await updateIssue({ workspaceSlug, issueId: id, patch: changes }));
			setSelected(new Set());
		} catch (cause) {
			setError(`Bulk update failed: ${cause instanceof Error ? cause.message : String(cause)}`);
		} finally {
			setBusy(false);
		}
	}
	return (
		<Selection.Provider value={{ selected, toggle }}>
			<div
				className="flex items-center gap-2 flex-wrap text-sm mb-3"
				role="toolbar"
				aria-label="Bulk issue actions"
			>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setSelected(new Set(issues.map((issue) => issue.id)))}
					disabled={busy || issues.length === 0}
				>
					Select all loaded
				</Button>
				{selected.size > 0 && (
					<>
						<span>{selected.size} selected</span>
						<Select
							value=""
							options={[
								{ value: "", label: "Change status" },
								...statuses.map((status) => ({ value: status.id, label: status.name })),
							]}
							onChange={(value) => {
								if (value) void change({ statusId: value });
							}}
							disabled={busy}
							ariaLabel="Bulk status"
						/>
						<Select
							value=""
							options={[
								{ value: "", label: "Change priority" },
								...["urgent", "high", "medium", "low", "none"].map((value) => ({
									value,
									label: value,
								})),
							]}
							onChange={(value) => {
								if (value) void change({ priority: value });
							}}
							disabled={busy}
							ariaLabel="Bulk priority"
						/>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setSelected(new Set())}
							disabled={busy}
						>
							Clear selection
						</Button>
					</>
				)}
				{error && (
					<p role="alert" className="text-danger-text">
						{error}
					</p>
				)}
			</div>
			{children}
		</Selection.Provider>
	);
}
