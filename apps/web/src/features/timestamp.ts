/** Display API unix seconds identically during SSR and hydration, independent of locale or timezone. */
export function formatTimestamp(seconds: number): string {
	const date = new Date(seconds * 1000);
	if (Number.isNaN(date.getTime())) return "Invalid Date";
	return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** UTC calendar date for display only. Date-input parsing keeps its local-midnight contract. */
export function formatTimestampDate(seconds: number): string {
	const date = new Date(seconds * 1000);
	if (Number.isNaN(date.getTime())) return "Invalid Date";
	return `${date.toISOString().slice(0, 10)} UTC`;
}
