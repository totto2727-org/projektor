import { useEffect, useState } from "preact/hooks";
import { formatIssueRef } from "../lib/issue-ref";
import { statusDisplayName } from "../lib/status";
import { apiFetch } from "../utils/api-client";
import { issueUrl } from "../utils/issue-url";
import { categoryColor, type Issue } from "./board-utils";

interface Props {
	workspaceSlug?: string;
}

const OPEN_CATEGORIES = new Set(["todo", "in_progress", "in_review"]);
const STATUS_ORDER = new Map([
	["in_review", 0],
	["in_progress", 1],
	["todo", 2],
	["backlog", 3],
]);
const PRIORITY_ORDER = new Map([
	["urgent", 0],
	["high", 1],
	["medium", 2],
	["low", 3],
	["none", 4],
]);

function statusOrder(issue: Issue): number {
	if (issue.status_key === "backlog" || issue.status_key === "in_review") {
		return STATUS_ORDER.get(issue.status_key) ?? 4;
	}
	return STATUS_ORDER.get(issue.status_category ?? "") ?? 4;
}

function compareIssues(a: Issue, b: Issue): number {
	return (
		statusOrder(a) - statusOrder(b) ||
		(PRIORITY_ORDER.get(a.priority) ?? 5) - (PRIORITY_ORDER.get(b.priority) ?? 5) ||
		b.updated_at - a.updated_at
	);
}

function getStoryPoints(issue: Issue): string | null {
	const field = (issue.customFields ?? []).find((f) => f.key === "story_points");
	return field?.value ?? null;
}

function spBadge(pts: string) {
	return (
		<span
			class="text-[0.68rem] text-text-muted bg-surface border border-border rounded-[3px]
				px-[0.3rem] font-semibold whitespace-nowrap leading-[1.6]"
		>
			{pts} SP
		</span>
	);
}

function priorityBadge(issue: Issue) {
	return (
		<span
			class="inline-flex items-center px-1.5 py-0.5 rounded text-[0.7rem] font-semibold capitalize whitespace-nowrap"
			style={{
				background: `var(--priority-${issue.priority}-bg, var(--priority-low-bg))`,
				color: `var(--priority-${issue.priority}-text, var(--text-muted))`,
			}}
		>
			{issue.priority === "none" ? "–" : issue.priority}
		</span>
	);
}

function statusBadge(issue: Issue) {
	return (
		<span class="font-medium text-sm" style={{ color: categoryColor(issue.status_category) }}>
			{statusDisplayName(issue.status_name, issue.status_key)}
		</span>
	);
}

function IssuesTable({ issues }: { issues: Issue[] }) {
	return (
		<div>
			{/* Desktop table */}
			<div class="overflow-x-auto max-sm:hidden">
				<table class="w-full border-collapse text-[0.9rem]">
					<thead>
						<tr class="bg-surface">
							<th class="text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base">
								#
							</th>
							<th class="text-left px-3 py-2 border-b-2 border-border font-semibold w-full text-text-base">
								Title
							</th>
							<th class="text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base">
								Priority
							</th>
							<th class="text-left px-3 py-2 border-b-2 border-border font-semibold whitespace-nowrap text-text-base">
								Status
							</th>
						</tr>
					</thead>
					<tbody>
						{issues.map((issue) => {
							const pts = getStoryPoints(issue);
							return (
								<tr key={issue.id} class="border-b border-border">
									<td class="px-3 py-2 align-middle whitespace-nowrap">
										<a
											href={issueUrl(issue.project_key, issue.number, issue.title, issue.id)}
											class="text-text-muted font-mono text-[0.8rem] no-underline hover:underline focus:underline"
										>
											{formatIssueRef(issue.project_key, issue.number)}
										</a>
									</td>
									<td class="px-3 py-2 align-middle text-text-base">
										<a
											href={issueUrl(issue.project_key, issue.number, issue.title, issue.id)}
											class="text-text-base no-underline hover:underline focus:underline"
										>
											{issue.title}
										</a>
									</td>
									<td class="px-3 py-2 align-middle whitespace-nowrap">
										<div class="flex items-center gap-[0.375rem]">
											{priorityBadge(issue)}
											{pts && spBadge(pts)}
										</div>
									</td>
									<td class="px-3 py-2 align-middle whitespace-nowrap">{statusBadge(issue)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			{/* Mobile cards */}
			<div class="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
				{issues.map((issue) => (
					<div key={issue.id} class="py-3 px-4 border border-border rounded-md bg-surface">
						<a
							href={issueUrl(issue.project_key, issue.number, issue.title, issue.id)}
							class="inline-block font-mono text-[0.8rem] text-text-muted no-underline hover:underline focus:underline mb-1"
						>
							{formatIssueRef(issue.project_key, issue.number)}
						</a>
						<a
							href={issueUrl(issue.project_key, issue.number, issue.title, issue.id)}
							class="no-underline"
						>
							<div class="text-[0.9rem] text-text-base font-medium mb-2">{issue.title}</div>
						</a>
						<div class="flex gap-[0.375rem] flex-wrap items-center">
							{priorityBadge(issue)}
							{statusBadge(issue)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export default function MyIssues({ workspaceSlug }: Props) {
	const [issues, setIssues] = useState<Issue[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError(null);
			try {
				// PROJ-444: "me" resolves server-side to the calling user — no more
				// /auth/me round trip before this fetch can even start.
				const loaded: Issue[] = [];
				let cursor: string | null = null;
				do {
					const query = new URLSearchParams({ assignee: "me", limit: "100" });
					if (cursor) query.set("cursor", cursor);
					const data = await apiFetch<{ items: Issue[]; nextCursor?: string | null }>(
						`/api/issues?${query}`,
						{ workspaceSlug }
					);
					loaded.push(...(Array.isArray(data.items) ? data.items : []));
					cursor = data.nextCursor ?? null;
				} while (cursor);
				setIssues(loaded);
			} catch (e) {
				setError(String(e));
			} finally {
				setLoading(false);
			}
		})();
	}, [workspaceSlug]);

	if (loading) return <p aria-live="polite">Loading…</p>;
	if (error)
		return (
			<p role="alert" class="text-danger-text">
				Failed to load issues: {error}
			</p>
		);

	const visible = issues
		.filter((i) => OPEN_CATEGORIES.has(i.status_category ?? ""))
		.sort(compareIssues);
	const hasAny = visible.length > 0;

	return (
		<div>
			<div class="mb-5">
				<span class="text-sm text-text-muted">
					{visible.length} issue{visible.length !== 1 ? "s" : ""}
				</span>
			</div>

			{!hasAny ? (
				<div class="text-center py-16 text-text-muted">
					<p class="text-lg font-medium mb-1">No open issues assigned to you</p>
					<p class="text-sm">You have no open issues across any project.</p>
				</div>
			) : (
				<IssuesTable issues={visible} />
			)}
		</div>
	);
}
