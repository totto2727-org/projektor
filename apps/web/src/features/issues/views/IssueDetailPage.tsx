"use client";
import type { RequestScope } from "../../../server/request-context";
import IssueDetail from "../legacy/IssueDetail";
import type { Attachment, Comment, Issue, IssueLink, Member, Status, TaskType } from "../types";
import { SelectionRequired } from "./shared";
export interface IssueDetailInitialData {
	readonly issue: Issue;
	readonly comments: readonly Comment[];
	readonly links: readonly IssueLink[];
	readonly attachments: readonly Attachment[];
	readonly statuses: readonly Status[];
	readonly taskTypes: readonly TaskType[];
	readonly members: readonly Member[];
	readonly parent: Issue | null;
	readonly children: readonly Issue[];
	readonly currentUserId: string;
}
export function IssueDetailPage({
	scope,
	workspaceSlug,
	initialData,
}: {
	scope: RequestScope;
	workspaceSlug: string;
	initialData: IssueDetailInitialData | null;
}) {
	if (!initialData) return <SelectionRequired scope={scope} label="Issue" />;
	return (
		<IssueDetail
			key={`${scope.user.id}:${workspaceSlug}:${initialData.issue.id}`}
			workspaceSlug={workspaceSlug}
			initialData={initialData}
		/>
	);
}
