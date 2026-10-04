"use client";
import { formatIssueRef } from "../../lib/issue-ref";
import { issueUrl } from "../../utils/issue-url";
import { useMediaQuery } from "../../utils/use-media-query";
import type { Issue, SortKey, TaskStatus } from "../board-utils";
import { IssueSelectionControl } from "./BulkActions";
import {
	getStoryPoints,
	PrioritySelect,
	SortableHeader,
	StatusSelect,
	spBadge,
	statusBadge,
} from "./issue-render-helpers";
import { type IssuePagination, PageNavigation } from "./PageNavigation";

interface ListSectionProps {
	issues: Issue[];
	statuses: TaskStatus[];
	updatingId: string | null;
	updatingPriorityId: string | null;
	changeStatus: (issueId: string, statusId: string) => void;
	changePriority: (issueId: string, priority: string) => void;
	sortBy: SortKey;
	sortDir: "asc" | "desc";
	onSort: (key: SortKey) => void;
	pagination: IssuePagination;
}

interface RowsProps {
	issues: Issue[];
	statuses: TaskStatus[];
	updatingId: string | null;
	updatingPriorityId: string | null;
	changeStatus: (issueId: string, statusId: string) => void;
	changePriority: (issueId: string, priority: string) => void;
}

function DesktopTable({
	issues,
	statuses,
	updatingId,
	updatingPriorityId,
	changeStatus,
	changePriority,
	sortBy,
	sortDir,
	onSort,
}: RowsProps & { sortBy: SortKey; sortDir: "asc" | "desc"; onSort: (key: SortKey) => void }) {
	return (
		<div className="overflow-x-auto max-sm:hidden">
			<table className="w-full border-collapse text-[0.9rem]">
				<thead>
					<tr className="bg-surface">
						<SortableHeader
							label="#"
							sortKey="number"
							sortBy={sortBy}
							sortDir={sortDir}
							onSort={onSort}
						/>
						<SortableHeader
							label="Title"
							sortKey="title"
							sortBy={sortBy}
							sortDir={sortDir}
							onSort={onSort}
							extraClass="w-full"
						/>
						<SortableHeader
							label="Priority"
							sortKey="priority"
							sortBy={sortBy}
							sortDir={sortDir}
							onSort={onSort}
						/>
						<SortableHeader
							label="Assignee"
							sortKey="assignee"
							sortBy={sortBy}
							sortDir={sortDir}
							onSort={onSort}
						/>
						<SortableHeader
							label="Status"
							sortKey="status"
							sortBy={sortBy}
							sortDir={sortDir}
							onSort={onSort}
						/>
					</tr>
				</thead>
				<tbody>
					{issues.map((issue) => {
						const pts = getStoryPoints(issue);
						return (
							<tr key={issue.id} className="border-b border-border">
								<td className="px-3 py-2 align-middle whitespace-nowrap">
									<IssueSelectionControl issue={issue} />
									<a
										href={issueUrl(
											issue.project_key,
											issue.number,
											issue.title,
											issue.id,
											issue.workspaceSlug
										)}
										className="text-text-muted font-mono text-[0.8rem] no-underline hover:underline focus:underline"
									>
										{formatIssueRef(issue.project_key, issue.number)}
									</a>
								</td>
								<td className="px-3 py-2 align-middle text-text-base">
									<a
										href={issueUrl(
											issue.project_key,
											issue.number,
											issue.title,
											issue.id,
											issue.workspaceSlug
										)}
										className="text-text-base no-underline hover:underline focus:underline"
									>
										{issue.title}
									</a>
								</td>
								<td className="px-3 py-2 align-middle whitespace-nowrap">
									<div className="flex items-center gap-[0.375rem]">
										<PrioritySelect
											issue={issue}
											busy={updatingPriorityId === issue.id}
											onChange={(v) => changePriority(issue.id, v)}
										/>
										{pts && spBadge(pts)}
									</div>
								</td>
								<td className="px-3 py-2 align-middle whitespace-nowrap text-text-base">
									{issue.assignee_name ?? <span className="text-text-muted">—</span>}
								</td>
								<td className="px-3 py-2 align-middle whitespace-nowrap">
									<StatusSelect
										issue={issue}
										statuses={statuses}
										busy={updatingId === issue.id}
										onChange={(v) => changeStatus(issue.id, v)}
									/>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function MobileCards({ issues, updatingPriorityId, changePriority }: RowsProps) {
	return (
		<div className="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
			{issues.map((issue) => (
				<div key={issue.id} className="py-3 px-4 border border-border rounded-md bg-surface">
					<IssueSelectionControl issue={issue} />
					<a
						href={issueUrl(
							issue.project_key,
							issue.number,
							issue.title,
							issue.id,
							issue.workspaceSlug
						)}
						className="inline-block font-mono text-[0.8rem] text-text-muted no-underline hover:underline focus:underline mb-1"
					>
						{formatIssueRef(issue.project_key, issue.number)}
					</a>
					<a
						href={issueUrl(
							issue.project_key,
							issue.number,
							issue.title,
							issue.id,
							issue.workspaceSlug
						)}
						className="no-underline"
					>
						<div className="text-[0.9rem] text-text-base font-medium mb-2">{issue.title}</div>
					</a>
					<div className="flex gap-[0.375rem] flex-wrap">
						<PrioritySelect
							issue={issue}
							busy={updatingPriorityId === issue.id}
							onChange={(v) => changePriority(issue.id, v)}
						/>
						{statusBadge(issue)}
					</div>
				</div>
			))}
		</div>
	);
}

export default function ListSection({
	issues,
	statuses,
	updatingId,
	updatingPriorityId,
	changeStatus,
	changePriority,
	sortBy,
	sortDir,
	onSort,
	pagination,
}: ListSectionProps) {
	// PROJ-862: render ONE layout (Tailwind's max-sm breakpoint), not both hidden by CSS.
	const isMobile = useMediaQuery("(max-width: 639.98px)");

	if (issues.length === 0) {
		return <p className="text-text-base">No issues match the current filters.</p>;
	}

	return (
		<>
			{!isMobile && (
				<DesktopTable
					issues={issues}
					statuses={statuses}
					updatingId={updatingId}
					updatingPriorityId={updatingPriorityId}
					changeStatus={changeStatus}
					changePriority={changePriority}
					sortBy={sortBy}
					sortDir={sortDir}
					onSort={onSort}
				/>
			)}

			{isMobile !== false && (
				<MobileCards
					issues={issues}
					statuses={statuses}
					updatingId={updatingId}
					updatingPriorityId={updatingPriorityId}
					changeStatus={changeStatus}
					changePriority={changePriority}
				/>
			)}

			<PageNavigation {...pagination} />
		</>
	);
}
