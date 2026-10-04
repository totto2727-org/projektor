"use client";
import type { ProjectSummary, RequestScope } from "../../../server/request-context";
import EpicList from "../legacy/EpicList";
import type { IssuePage, Status, TaskType } from "../types";
import { SelectionRequired } from "./shared";
export interface EpicsInitialData {
	readonly page: IssuePage;
	readonly statuses: readonly Status[];
	readonly taskTypes: readonly TaskType[];
	readonly project: ProjectSummary;
	readonly projects: readonly ProjectSummary[];
	readonly search: string;
}
export function EpicsPage({
	scope,
	workspaceSlug,
	initialData,
}: {
	scope: RequestScope;
	workspaceSlug: string;
	initialData: EpicsInitialData | null;
}) {
	if (!initialData) return <SelectionRequired scope={scope} label="Epics" />;
	return (
		<main>
			<h1 className="text-2xl font-bold mb-6">Epics</h1>
			<EpicList
				key={`${workspaceSlug}:${initialData.search}`}
				workspaceSlug={workspaceSlug}
				initialData={initialData}
			/>
		</main>
	);
}
