"use client";

import { useForm, useStore } from "@tanstack/react-form";
import { Schema } from "effect";
import { type Dispatch, type SetStateAction, useOptimistic, useState, useTransition } from "react";
import { unwrapResult } from "../../client/functions";
import { Button } from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import { formatTimestampDate } from "../timestamp";
import { navigateFeature } from "../wiki/navigation";
import {
	convertFeedbackToIssue,
	convertSelectedFeedbackToIssue,
	markFeedbackReviewed,
	markSelectedFeedbackReviewed,
} from "./actions";

export interface Feedback {
	id: string;
	sourceId: string;
	sourceName: string | null;
	rating: number | null;
	ratingScale: string | null;
	body: string | null;
	submitterLabel: string | null;
	sourceUrl: string | null;
	appVersion: string | null;
	status: string;
	linkedIssueId: string | null;
	createdAt: number;
}

interface Props {
	workspaceSlug?: string;
	projectId: string;
	sourceId: string;
	initialRows: readonly Feedback[];
	initialStatus?: string;
}

const STATUS_OPTIONS = [
	{ value: "", label: "All" },
	{ value: "new", label: "New" },
	{ value: "reviewed", label: "Reviewed" },
	{ value: "actioned", label: "Actioned" },
];

const TD = "px-3 py-2 border-b border-border align-top text-[0.875rem]";
const TH =
	"text-left px-3 py-2 border-b-2 border-border font-semibold text-text-base whitespace-nowrap";

function ratingDisplay(rating: number | null, scale: string | null): string {
	if (rating === null) return "—";
	if (scale === "thumbs") return rating > 0 ? "👍" : "👎";
	return "★".repeat(Math.max(0, Math.min(5, rating)));
}

function formatDate(ts: number): string {
	return formatTimestampDate(ts);
}

function parseContext(
	sourceUrl: string | null,
): { url: string; params: [string, string][] } | null {
	if (!sourceUrl) return null;
	try {
		const parsed = new URL(sourceUrl);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		return { url: sourceUrl, params: Array.from(parsed.searchParams.entries()) };
	} catch {
		return null;
	}
}

function FeedbackContext({
	row,
	expanded,
	onToggle,
}: {
	row: Feedback;
	expanded: boolean;
	onToggle: () => void;
}) {
	const context = parseContext(row.sourceUrl);
	if (!context) return null;
	return (
		<div className="mt-1">
			<button type="button" className="text-[0.75rem] text-text-muted underline" onClick={onToggle}>
				Context ({context.params.length})
			</button>
			{expanded && (
				<div className="text-[0.75rem] text-text-muted mt-1 flex flex-col gap-0.5">
					<a href={context.url} target="_blank" rel="noopener noreferrer" className="underline">
						{context.url}
					</a>
					{context.params.map(([key, value]) => (
						<div key={key}>
							{key}: {value}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function FeedbackRowActions({
	row,
	onMarkReviewed,
	onConvert,
}: {
	row: Feedback;
	onMarkReviewed: (id: string) => void;
	onConvert: (id: string) => void;
}) {
	return (
		<div className="flex gap-2 flex-wrap">
			{row.status === "new" && (
				<Button type="button" variant="outline" size="sm" onClick={() => onMarkReviewed(row.id)}>
					Mark reviewed
				</Button>
			)}
			{row.linkedIssueId ? (
				<span className="text-[0.8rem] text-text-muted">Linked</span>
			) : (
				<Button type="button" variant="outline" size="sm" onClick={() => onConvert(row.id)}>
					Convert to issue
				</Button>
			)}
		</div>
	);
}

interface FeedbackMobileCardsProps {
	rows: Feedback[];
	selected: Set<string>;
	expanded: Set<string>;
	onToggleRow: (id: string) => void;
	onToggleExpanded: (id: string) => void;
	onMarkReviewed: (id: string) => void;
	onConvert: (id: string) => void;
}

function FeedbackMobileCards({
	rows,
	selected,
	expanded,
	onToggleRow,
	onToggleExpanded,
	onMarkReviewed,
	onConvert,
}: FeedbackMobileCardsProps) {
	return (
		<div className="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
			{rows.map((r) => (
				<div key={r.id} className="py-3 px-4 border border-border rounded-md bg-surface">
					<div className="flex items-start gap-2 mb-2">
						<input
							type="checkbox"
							aria-label={`select row ${r.id}`}
							checked={selected.has(r.id)}
							onChange={() => onToggleRow(r.id)}
							className="mt-1"
						/>
						<div className="flex-1">
							<div className="flex justify-between items-center gap-2 mb-1">
								<span className="text-[0.9rem]">{ratingDisplay(r.rating, r.ratingScale)}</span>
								<span className="text-[0.75rem] text-text-muted">{formatDate(r.createdAt)}</span>
							</div>
							<div className="text-[0.875rem] text-text-base">{r.body ?? "—"}</div>
							{r.submitterLabel && (
								<div className="text-[0.75rem] text-text-muted mt-1">{r.submitterLabel}</div>
							)}
							<FeedbackContext
								row={r}
								expanded={expanded.has(r.id)}
								onToggle={() => onToggleExpanded(r.id)}
							/>
							<div className="text-[0.75rem] text-text-muted mt-1">{r.status}</div>
						</div>
					</div>
					<FeedbackRowActions row={r} onMarkReviewed={onMarkReviewed} onConvert={onConvert} />
				</div>
			))}
		</div>
	);
}

interface FeedbackTableProps {
	rows: Feedback[];
	selected: Set<string>;
	expanded: Set<string>;
	onToggleSelectAll: () => void;
	onToggleRow: (id: string) => void;
	onToggleExpanded: (id: string) => void;
	onMarkReviewed: (id: string) => void;
	onConvert: (id: string) => void;
}

function FeedbackTable({
	rows,
	selected,
	expanded,
	onToggleSelectAll,
	onToggleRow,
	onToggleExpanded,
	onMarkReviewed,
	onConvert,
}: FeedbackTableProps) {
	return (
		<div className="overflow-x-auto max-sm:hidden">
			<table className="w-full border-collapse text-[0.9rem]">
				<thead>
					<tr>
						<th className={TH}>
							<input
								type="checkbox"
								aria-label="select all"
								checked={rows.length > 0 && selected.size === rows.length}
								onChange={onToggleSelectAll}
							/>
						</th>
						<th className={TH}>Rating</th>
						<th className={TH}>Feedback</th>
						<th className={TH}>Status</th>
						<th className={TH}>Received</th>
						<th className={TH}></th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.id}>
							<td className={TD}>
								<input
									type="checkbox"
									aria-label={`select row ${r.id}`}
									checked={selected.has(r.id)}
									onChange={() => onToggleRow(r.id)}
								/>
							</td>
							<td className={TD}>{ratingDisplay(r.rating, r.ratingScale)}</td>
							<td className={`${TD} text-text-base`}>
								<div>{r.body ?? "—"}</div>
								{r.submitterLabel && (
									<div className="text-[0.75rem] text-text-muted mt-1">{r.submitterLabel}</div>
								)}
								<FeedbackContext
									row={r}
									expanded={expanded.has(r.id)}
									onToggle={() => onToggleExpanded(r.id)}
								/>
							</td>
							<td className={`${TD} text-text-muted`}>{r.status}</td>
							<td className={`${TD} text-text-muted`}>{formatDate(r.createdAt)}</td>
							<td className={`${TD} whitespace-nowrap`}>
								<FeedbackRowActions row={r} onMarkReviewed={onMarkReviewed} onConvert={onConvert} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function useFeedbackActions(
	workspaceSlug: string | undefined,
	projectId: string,
	setError: (e: string | null) => void,
	setSelected: (s: Set<string>) => void,
	addOptimistic: (change: { ids: readonly string[]; status: string }) => void,
	startTransition: (action: () => Promise<void>) => void,
) {
	function convert(id: string) {
		startTransition(async () => {
			addOptimistic({ ids: [id], status: "actioned" });
			try {
				unwrapResult(await convertFeedbackToIssue({ workspaceSlug, projectId, feedbackId: id }));
			} catch (cause) {
				setError(String(cause));
			}
		});
	}
	function markReviewed(id: string) {
		startTransition(async () => {
			addOptimistic({ ids: [id], status: "reviewed" });
			try {
				unwrapResult(await markFeedbackReviewed({ workspaceSlug, projectId, feedbackId: id }));
			} catch (cause) {
				setError(String(cause));
			}
		});
	}
	function bulkMarkReviewed(selected: Set<string>) {
		startTransition(async () => {
			const feedbackIds = [...selected];
			addOptimistic({ ids: feedbackIds, status: "reviewed" });
			try {
				unwrapResult(await markSelectedFeedbackReviewed({ workspaceSlug, projectId, feedbackIds }));
				setSelected(new Set());
			} catch (cause) {
				setError(String(cause));
			}
		});
	}
	function bulkConvertToIssue(selected: Set<string>) {
		startTransition(async () => {
			const feedbackIds = [...selected];
			addOptimistic({ ids: feedbackIds, status: "actioned" });
			try {
				unwrapResult(
					await convertSelectedFeedbackToIssue({ workspaceSlug, projectId, feedbackIds }),
				);
				setSelected(new Set());
			} catch (cause) {
				setError(String(cause));
			}
		});
	}
	return { convert, markReviewed, bulkMarkReviewed, bulkConvertToIssue };
}

function useToggleSet() {
	const [set, setSet] = useState<Set<string>>(new Set());
	function toggle(id: string) {
		setSet((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	return [set, toggle, setSet] as const;
}

function useSelectedFeedback() {
	const form = useForm({
		defaultValues: { ids: [] as string[] },
		validators: {
			onChange: Schema.toStandardSchemaV1(
				Schema.Struct({
					ids: Schema.mutable(Schema.Array(Schema.String)).check(Schema.isMaxLength(500)),
				}),
			),
		},
	});
	const ids = useStore(form.store, (state) => state.values.ids);
	const selected = new Set(ids);
	const setSelected: Dispatch<SetStateAction<Set<string>>> = (value) => {
		const current = new Set(form.getFieldValue("ids"));
		form.setFieldValue("ids", [...(typeof value === "function" ? value(current) : value)]);
	};
	function toggle(id: string) {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	return [selected, toggle, setSelected] as const;
}

export default function FeedbackList({
	workspaceSlug,
	projectId,
	sourceId,
	initialRows,
	initialStatus = "",
}: Props) {
	const status = initialStatus;
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();
	const [optimisticRows, addOptimistic] = useOptimistic(
		initialRows,
		(current, change: { ids: readonly string[]; status: string }) => {
			const ids = new Set(change.ids);
			return current.map((row) => (ids.has(row.id) ? { ...row, status: change.status } : row));
		},
	);
	const rows = optimisticRows.filter((row) => !status || row.status === status);
	const [selected, toggleRow, setSelected] = useSelectedFeedback();
	const [expanded, toggleExpanded] = useToggleSet();
	const { convert, markReviewed, bulkMarkReviewed, bulkConvertToIssue } = useFeedbackActions(
		workspaceSlug,
		projectId,
		setError,
		setSelected,
		addOptimistic,
		startTransition,
	);

	function toggleSelectAll() {
		setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
	}

	return (
		<section>
			<div className="flex gap-4 items-end mb-4">
				<div className="flex flex-col gap-1">
					<span className="text-[0.8rem] font-semibold text-text-muted">Status</span>
					<Select
						ariaLabel="Status"
						value={status}
						onChange={(value) => {
							setSelected(new Set());
							const params = new URLSearchParams({ projectId, tab: "items" });
							if (workspaceSlug) params.set("workspace", workspaceSlug);
							if (value) params.set("status", value);
							navigateFeature(`/feedback/${encodeURIComponent(sourceId)}?${params}`);
						}}
						options={STATUS_OPTIONS}
					/>
				</div>
			</div>

			{error && (
				<p role="alert" className="text-danger-text">
					{error}
				</p>
			)}
			{selected.size > 0 && (
				<div className="flex gap-2 items-center mb-3 p-2 bg-surface border border-border rounded">
					<span className="text-[0.85rem] text-text-muted">{selected.size} selected</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => bulkMarkReviewed(selected)}
					>
						Mark all reviewed
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => bulkConvertToIssue(selected)}
					>
						Convert all to issue
					</Button>
				</div>
			)}
			{pending && <p aria-live="polite">Updating feedback…</p>}
			{rows.length === 0 ? (
				<div className="p-6 text-center text-text-muted bg-surface rounded-lg border border-border">
					No feedback yet.
				</div>
			) : (
				<>
					<FeedbackTable
						rows={rows}
						selected={selected}
						expanded={expanded}
						onToggleSelectAll={toggleSelectAll}
						onToggleRow={toggleRow}
						onToggleExpanded={toggleExpanded}
						onMarkReviewed={markReviewed}
						onConvert={convert}
					/>
					<FeedbackMobileCards
						rows={rows}
						selected={selected}
						expanded={expanded}
						onToggleRow={toggleRow}
						onToggleExpanded={toggleExpanded}
						onMarkReviewed={markReviewed}
						onConvert={convert}
					/>
				</>
			)}
		</section>
	);
}
