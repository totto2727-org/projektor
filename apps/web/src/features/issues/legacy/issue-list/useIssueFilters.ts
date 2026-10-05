"use client";
import { Schema } from "effect";
import { useState } from "react";
import { Text, useIssueForm } from "../../forms";
import type { SortKey } from "../board-utils";
import type { SavedViewFilters } from "../saved-views";
import { parseDateField, parseListParam, useFilterUrlSync } from "./useFilterUrlSync";

function readInitialFilters(search: string, projectKey: string) {
	const params = new URLSearchParams(search);
	return {
		statuses: parseListParam(params.get("status")),
		priorities: parseListParam(params.get("priority")),
		project: projectKey,
		epic: params.get("epic") ?? "",
		sprintId: params.get("sprintId") ?? "",
		hideEpics: params.get("hideEpics") === "1",
		dateField: parseDateField(params.get("dateField")),
		dateFrom: params.get("dateFrom") ?? "",
		dateTo: params.get("dateTo") ?? "",
	};
}

/** Owns all issue-list filter/sort state, plus URL <-> state sync (PROJ-60/211/212). */
export function useIssueFilters(
	search: string = "",
	projectKey: string = "",
	projects: readonly { key: string; id: string }[] = [],
) {
	// Server route DTOs seed filters deterministically for SSR and first hydration.
	// Only explicit field edits trigger canonical navigation.
	const initial = readInitialFilters(search, projectKey);
	const filterForm = useIssueForm(
		{
			filterStatuses: initial.statuses,
			filterPriorities: initial.priorities,
			filterProject: initial.project,
			filterType: new URLSearchParams(search).get("type") ?? "",
			filterEpicId: initial.epic,
			hideEpics: initial.hideEpics,
			filterDateField: initial.dateField,
			filterDateFrom: initial.dateFrom,
			filterDateTo: initial.dateTo,
			filterSprintId: initial.sprintId,
		},
		Schema.Struct({
			filterStatuses: Schema.Array(Text),
			filterPriorities: Schema.Array(Text),
			filterProject: Text,
			filterType: Text,
			filterEpicId: Text,
			hideEpics: Schema.Boolean,
			filterDateField: Schema.Literals(["", "completed", "updated"]),
			filterDateFrom: Text,
			filterDateTo: Text,
			filterSprintId: Text,
		}),
	);
	const [filterStatuses, setFilterStatuses] = filterForm.field("filterStatuses");
	const [filterPriorities, setFilterPriorities] = filterForm.field("filterPriorities");
	const [filterProject, setFilterProject] = filterForm.field("filterProject");
	const [filterType, setFilterType] = filterForm.field("filterType");
	const [filterEpicId, setFilterEpicId] = filterForm.field("filterEpicId");
	const [hideEpics, setHideEpics] = filterForm.field("hideEpics");
	const [filterDateField, setFilterDateField] = filterForm.field("filterDateField");
	const [filterDateFrom, setFilterDateFrom] = filterForm.field("filterDateFrom");
	const [filterDateTo, setFilterDateTo] = filterForm.field("filterDateTo");
	const [filterSprintId, setFilterSprintId] = filterForm.field("filterSprintId");
	const [sortBy, setSortBy] = useState<SortKey>("created_at");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

	useFilterUrlSync(
		{
			filterProject,
			filterType,
			filterStatuses,
			setFilterStatuses,
			filterPriorities,
			setFilterPriorities,
			setFilterProject,
			filterEpicId,
			setFilterEpicId,
			filterSprintId,
			setFilterSprintId,
			hideEpics,
			setHideEpics,
			filterDateField,
			setFilterDateField,
			filterDateFrom,
			setFilterDateFrom,
			filterDateTo,
			setFilterDateTo,
		},
		search,
		projects,
	);

	function handleHeaderClick(key: SortKey) {
		if (sortBy === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(key);
			setSortDir("asc");
		}
	}

	const filtersBundle: SavedViewFilters = {
		statuses: filterStatuses,
		priorities: filterPriorities,
		project: filterProject,
		type: filterType,
		epicId: filterEpicId,
		sprintId: filterSprintId,
		hideEpics,
		dateField: filterDateField,
		dateFrom: filterDateFrom,
		dateTo: filterDateTo,
	};

	function applyFilters(filters: SavedViewFilters) {
		setFilterStatuses(filters.statuses);
		setFilterPriorities(filters.priorities);
		setFilterProject(filters.project);
		setFilterType(filters.type);
		setFilterEpicId(filters.epicId);
		setFilterSprintId(filters.sprintId);
		setHideEpics(filters.hideEpics);
		setFilterDateField(parseDateField(filters.dateField));
		setFilterDateFrom(filters.dateFrom);
		setFilterDateTo(filters.dateTo);
	}

	return {
		filterStatuses,
		setFilterStatuses,
		filterPriorities,
		setFilterPriorities,
		filterProject,
		setFilterProject,
		filterType,
		setFilterType,
		filterEpicId,
		setFilterEpicId,
		hideEpics,
		setHideEpics,
		filterDateField,
		setFilterDateField,
		filterDateFrom,
		setFilterDateFrom,
		filterDateTo,
		setFilterDateTo,
		filterSprintId,
		setFilterSprintId,
		sortBy,
		setSortBy,
		sortDir,
		setSortDir,
		handleHeaderClick,
		filtersBundle,
		applyFilters,
	};
}
