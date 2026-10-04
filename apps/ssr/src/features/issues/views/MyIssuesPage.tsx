"use client";
import type { RequestScope, WorkspaceMembership } from "../../../server/request-context";
import MyIssues from "../legacy/MyIssues";
import type { Issue } from "../types";
export type ScopedIssue = Issue & { readonly workspaceSlug: string };
export interface MyIssuesInitialData {
	readonly issues: readonly ScopedIssue[];
	readonly memberships: readonly WorkspaceMembership[];
}
export function MyIssuesPage({
	initialData,
}: {
	scope: RequestScope;
	initialData: MyIssuesInitialData;
}) {
	return (
		<main>
			<h1 className="text-2xl font-bold mb-6">My Issues</h1>
			<MyIssues initialData={initialData} />
		</main>
	);
}
