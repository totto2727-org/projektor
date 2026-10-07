/**
 * Builds GET /api/issues query strings. This endpoint calls the project filter
 * `project`, unlike the search and next endpoints which have their own wire DTOs.
 */
export function issueListQuery(url: URL, extra: Readonly<Record<string, string>> = {}): string {
	const allowed = [
		"status",
		"priority",
		"assignee",
		"parentId",
		"noParent",
		"typeId",
		"sprintId",
		"cursor",
		"limit",
		"q",
		"sort",
		"order",
		"dateField",
		"dateFrom",
		"dateTo",
	];
	const params = new URLSearchParams();
	for (const key of allowed)
		for (const value of url.searchParams.getAll(key)) params.append(key, value);
	for (const [key, value] of Object.entries(extra)) params.set(key, value);
	return params.toString();
}
