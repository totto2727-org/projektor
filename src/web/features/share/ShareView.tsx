"use client";

import { Fragment } from "react";
import { Badge } from "../../components/ui/Badge";
import { MarkdownPreview } from "../../components/markdown/MarkdownPreview";
import type { RenderedMarkdown } from "../../components/markdown/render";
import type { WorkspaceBrandDto } from "./brand";

export interface SharedIssue {
	title: string;
	body: string | null;
	priority: string;
	status_name: string | null;
	status_category: string | null;
	project_key: string | null;
	project_name: string | null;
	assignee_name: string | null;
	created_at: number;
	expires_at: number;
	customFields: ReadonlyArray<{ key: string; label: string; type: string; value: string }>;
	brand: WorkspaceBrandDto;
}

const PRIORITY_LABELS: Record<string, string> = {
	urgent: "Urgent",
	high: "High",
	medium: "Medium",
	low: "Low",
	none: "No priority",
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
	urgent: { bg: "var(--priority-urgent-bg)", text: "var(--priority-urgent-text)" },
	high: { bg: "var(--priority-high-bg)", text: "var(--priority-high-text)" },
	medium: { bg: "var(--priority-medium-bg)", text: "var(--priority-medium-text)" },
	low: { bg: "var(--priority-low-bg)", text: "var(--priority-low-text)" },
	none: { bg: "var(--priority-none-bg)", text: "var(--priority-none-text)" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function ErrorState({ error }: { error: string }) {
	const isExpired = error === "not_found";
	return (
		<div className="p-8 text-center">
			<p className="text-5xl mb-4">{isExpired ? "🔗" : "⚠"}</p>
			<h2 className="mb-2">{isExpired ? "Link not found or expired" : "Something went wrong"}</h2>
			<p className="text-text-muted">
				{isExpired
					? "This share link may have expired (links are valid for 3 days) or the URL is incorrect."
					: "Unable to load the shared issue. Please try again later."}
			</p>
			<a href="/" className="text-accent no-underline mt-6 inline-block">
				← Go to Projektor
			</a>
		</div>
	);
}

function IssueHeader({ issue }: { issue: SharedIssue }) {
	const priorityStyle = PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS.none;
	return (
		<header className="mb-6">
			<div className="flex items-center gap-2 mb-3 flex-wrap">
				{/* Priority badge */}
				<Badge style={{ background: priorityStyle.bg, color: priorityStyle.text }}>
					{PRIORITY_LABELS[issue.priority] ?? issue.priority}
				</Badge>
				{/* Status badge */}
				{issue.status_name && (
					<Badge className="bg-surface text-text-muted border border-border">
						{issue.status_name}
					</Badge>
				)}
				{/* Project */}
				{issue.project_name && (
					<span className="text-xs text-text-muted">
						{issue.project_name}
						{issue.project_key ? ` (${issue.project_key})` : ""}
					</span>
				)}
			</div>
			<h1 className="m-0 text-[1.375rem] font-bold leading-[1.3]">{issue.title}</h1>
			<div className="mt-2 text-[0.8rem] text-text-muted flex gap-4 flex-wrap">
				{issue.assignee_name && <span>Assignee: {issue.assignee_name}</span>}
				<span>Created {formatDate(issue.created_at)}</span>
			</div>
		</header>
	);
}

function CustomFieldsSection({ fields }: { fields: SharedIssue["customFields"] }) {
	if (fields.length === 0) return null;
	return (
		<div className="border-t border-border pt-4">
			<p className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-text-muted mb-3">
				Fields
			</p>
			<dl className="grid grid-cols-[max-content_1fr] gap-[0.4rem_1rem] text-[0.8125rem]">
				{fields.map((f) => (
					<Fragment key={f.key}>
						<dt className="text-text-muted font-medium">{f.label}</dt>
						<dd className="m-0">{f.value}</dd>
					</Fragment>
				))}
			</dl>
		</div>
	);
}

export default function ShareView({
	issue,
	renderedBody,
}: {
	readonly issue: SharedIssue;
	readonly renderedBody?: RenderedMarkdown;
}) {
	return (
		<div className="p-8">
			{/* Banner */}
			<div className="bg-surface border border-border rounded-md py-[0.625rem] px-4 mb-6 flex items-center justify-between flex-wrap gap-2 text-[0.8125rem] text-text-muted">
				<span>Shared view · Expires {formatDate(issue.expires_at)}</span>
				<a href="/" className="text-accent no-underline font-medium">
					Sign in to collaborate →
				</a>
			</div>

			{/* Header */}
			<IssueHeader issue={issue} />

			{/* Body */}
			{issue.body ? (
				<MarkdownPreview content={issue.body} initial={renderedBody} className="mb-6" />
			) : (
				<p className="text-text-muted italic mb-6">No description.</p>
			)}

			{/* Custom fields */}
			<CustomFieldsSection fields={issue.customFields} />
		</div>
	);
}
