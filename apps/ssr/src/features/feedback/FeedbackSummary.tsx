"use client";

import type { SourceSummary } from "./FeedbackSourceGrid";
import type { FeedbackVersionSummary } from "./FeedbackSourceSettings";

interface Props {
	workspaceSlug?: string;
	projectId: string;
	sourceId: string;
	initialSummary: SourceSummary | null;
}

function versionMetric(v: FeedbackVersionSummary): string {
	const parts: string[] = [];
	if (v.thumbsUpPct !== null) parts.push(`👍 ${v.thumbsUpPct}%`);
	if (v.avgFiveStar !== null) parts.push(`${v.avgFiveStar.toFixed(1)}★ avg`);
	if (parts.length === 0) parts.push("No ratings");
	return parts.join(" · ");
}

export default function FeedbackSummary({ initialSummary: summary }: Props) {
	if (!summary || summary.versions.length === 0) {
		return (
			<div className="p-6 text-center text-text-muted bg-surface rounded-lg border border-border">
				No feedback yet.
			</div>
		);
	}

	return (
		<section className="flex flex-col gap-4">
			<div className="bg-surface rounded-lg border border-border p-4">
				<div className="flex items-baseline gap-2 mb-2">
					<span className="text-[0.8rem] text-text-muted">{summary.totalCount} total</span>
				</div>
				<ul className="flex flex-col gap-1">
					{summary.versions.map((v) => (
						<li
							key={v.appVersion ?? "unknown"}
							className="flex flex-wrap gap-x-3 text-[0.875rem] text-text-muted"
						>
							<span className="font-medium text-text-base">
								{v.appVersion ?? "Unknown version"}
							</span>
							<span>{versionMetric(v)}</span>
							{v.withCommentCount > 0 && <span>{v.withCommentCount} with comments</span>}
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
