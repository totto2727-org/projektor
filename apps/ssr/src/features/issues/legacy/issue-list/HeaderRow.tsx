"use client";
import { Button } from "../../../../components/ui/Button";
import { getBacklogIssues, type Issue } from "../board-utils";
import type { ViewMode } from "./types-view";
import type { SearchResult } from "./useIssueSearch";

function countLabel(view: ViewMode, filtered: Issue[], totalIssues: number | null): string {
	const listCount = view === "backlog" ? getBacklogIssues(filtered).length : filtered.length;
	const suffix =
		view !== "backlog" && totalIssues !== null && totalIssues !== filtered.length
			? ` (of ${totalIssues})`
			: "";
	return `${listCount} issue${listCount !== 1 ? "s" : ""}${suffix}`;
}

function searchCountLabel(results: readonly SearchResult[], query: string): string {
	return `${results.length} result${results.length !== 1 ? "s" : ""} for «${query.trim()}»`;
}

interface HeaderRowProps {
	isSearchActive: boolean;
	searchResults: SearchResult[] | null;
	searchQuery: string;
	view: ViewMode;
	setView: (v: ViewMode) => void;
	filtered: Issue[];
	totalIssues: number | null;
	projectsCount: number;
	openCreateModal: () => void;
}

export default function HeaderRow({
	isSearchActive,
	searchResults,
	searchQuery,
	view,
	setView,
	filtered,
	totalIssues,
	projectsCount,
	openCreateModal,
}: HeaderRowProps) {
	const label =
		isSearchActive && searchResults !== null
			? searchCountLabel(searchResults, searchQuery)
			: countLabel(view, filtered, totalIssues);

	return (
		<div className="flex justify-between items-center gap-2 mb-3 max-sm:flex-col max-sm:items-stretch">
			<p className="text-sm text-text-muted m-0">{label}</p>

			<div className="flex gap-2 items-center max-sm:justify-between">
				{projectsCount > 0 && (
					<Button variant="primary" size="sm" onClick={openCreateModal}>
						+ New issue
					</Button>
				)}

				{!isSearchActive && (
					<fieldset
						aria-label="View mode"
						className="flex border border-border rounded-md overflow-hidden m-0 p-0"
					>
						<legend className="hidden">View mode</legend>
						{(["list", "board", "backlog"] as const).map((v) => (
							<button
								type="button"
								key={v}
								aria-pressed={view === v}
								onClick={() => setView(v)}
								className="border-none py-1 px-3 cursor-pointer text-[0.8rem] capitalize transition-colors duration-100"
								style={{
									borderRight: v !== "backlog" ? "1px solid var(--border)" : "none",
									background: view === v ? "var(--accent)" : "var(--bg)",
									color: view === v ? "var(--on-accent)" : "var(--text-muted)",
									fontWeight: view === v ? 600 : 400,
								}}
							>
								{v}
							</button>
						))}
					</fieldset>
				)}
			</div>
		</div>
	);
}
