"use client";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { navigateIssues } from "../../utils/navigation";
import { buildFilterUrlQueryString } from "../IssueList-helpers";
import type { DateField } from "./FiltersPopover";

export function parseListParam(v: string | null): string[] {
	return v ? v.split(",").filter(Boolean) : [];
}

export function parseDateField(v: string | null): DateField {
	return v === "completed" || v === "updated" ? v : "";
}

interface UrlSyncState {
	filterProject: string;
	filterType: string;
	filterStatuses: string[];
	setFilterStatuses: Dispatch<SetStateAction<string[]>>;
	filterPriorities: string[];
	setFilterPriorities: Dispatch<SetStateAction<string[]>>;
	setFilterProject: Dispatch<SetStateAction<string>>;
	filterEpicId: string;
	setFilterEpicId: Dispatch<SetStateAction<string>>;
	filterSprintId: string;
	setFilterSprintId: Dispatch<SetStateAction<string>>;
	hideEpics: boolean;
	setHideEpics: Dispatch<SetStateAction<boolean>>;
	filterDateField: DateField;
	setFilterDateField: Dispatch<SetStateAction<DateField>>;
	filterDateFrom: string;
	setFilterDateFrom: Dispatch<SetStateAction<string>>;
	filterDateTo: string;
	setFilterDateTo: Dispatch<SetStateAction<string>>;
}

/** Keeps the URL in sync with filter state (PROJ-60/211/212). */
export function useFilterUrlSync(
	state: UrlSyncState,
	search: string,
	projects: readonly { key: string; id: string }[] = []
) {
	const {
		filterStatuses,
		filterPriorities,
		filterEpicId,
		filterSprintId,
		hideEpics,
		filterDateField,
		filterDateFrom,
		filterDateTo,
	} = state;

	// PROJ-862: initial state is read from the URL synchronously (useIssueFilters'
	// lazy initialisers), not in a mount effect — the effect ran after the first
	// render, so the first issues request went out with no filters at all.

	// Sync filter state back to URL without page reload.
	const previous = useRef(
		JSON.stringify([
			state.filterProject,
			state.filterType,
			filterStatuses,
			filterPriorities,
			filterEpicId,
			filterSprintId,
			hideEpics,
			filterDateField,
			filterDateFrom,
			filterDateTo,
		])
	);
	useEffect(() => {
		const key = JSON.stringify([
			state.filterProject,
			state.filterType,
			filterStatuses,
			filterPriorities,
			filterEpicId,
			filterSprintId,
			hideEpics,
			filterDateField,
			filterDateFrom,
			filterDateTo,
		]);
		if (previous.current === key) return;
		previous.current = key;
		const qs = buildFilterUrlQueryString(search, {
			filterStatuses,
			filterPriorities,
			filterEpicId,
			filterSprintId,
			hideEpics,
			filterDateField,
			filterDateFrom,
			filterDateTo,
		});
		const params = new URLSearchParams(qs);
		params.delete("project");
		params.delete("cursor");
		const project = projects.find((entry) => entry.key === state.filterProject);
		if (project) params.set("projectId", project.id);
		else params.delete("projectId");
		if (state.filterType) params.set("type", state.filterType);
		else params.delete("type");
		navigateIssues(`${window.location.pathname}?${params}`);
	}, [
		state.filterProject,
		state.filterType,
		search,
		projects,
		filterStatuses,
		filterPriorities,
		filterEpicId,
		filterSprintId,
		hideEpics,
		filterDateField,
		filterDateFrom,
		filterDateTo,
	]);
}
