import { Schema } from "effect";

export const SprintListModeSchema = Schema.Literals(["all", "planned", "active", "completed"]);
export type SprintListMode = typeof SprintListModeSchema.Type;

const required = (label: string, maximum = 200) =>
	Schema.String.check(
		Schema.isMaxLength(maximum),
		Schema.makeFilter((value) => value.trim().length > 0 || `${label} is required.`),
	);
export const PlanningScopeFields = {
	workspaceSlug: required("Workspace"),
	projectId: required("Project"),
};
const date = Schema.String.check(
	Schema.makeFilter((value) => {
		const timestamp = Date.parse(`${value}T00:00:00Z`);
		return (
			(/^\d{4}-\d{2}-\d{2}$/.test(value) &&
				Number.isFinite(timestamp) &&
				new Date(timestamp).toISOString().slice(0, 10) === value) ||
			"Enter a valid date."
		);
	}),
);
const optionalDate = Schema.Union([Schema.Literal(""), date]);
export const SprintDraftFields = {
	name: required("Name", 100),
	goal: Schema.String.check(Schema.isMaxLength(280)),
	start: optionalDate,
	end: optionalDate,
};
export const SprintFormSchema = Schema.Struct({
	...PlanningScopeFields,
	...SprintDraftFields,
}).check(
	Schema.makeFilter(
		(value) =>
			!value.start ||
			!value.end ||
			value.start <= value.end || { path: ["end"], issue: "End date must not precede start date." },
	),
);
export type SprintFormValues = typeof SprintFormSchema.Type;
const OffsetSchema = Schema.Int.check(Schema.isBetween({ minimum: -840, maximum: 840 }));
export const CreateSprintInputSchema = Schema.Struct({
	...PlanningScopeFields,
	...SprintDraftFields,
	startOffset: OffsetSchema,
	endOffset: OffsetSchema,
}).check(
	Schema.makeFilter(
		(value) =>
			!value.start ||
			!value.end ||
			value.start <= value.end || { path: ["end"], issue: "End date must not precede start date." },
	),
);
export const EditSprintInputSchema = Schema.Struct({
	...CreateSprintInputSchema.fields,
	sprintId: required("Sprint"),
}).check(
	Schema.makeFilter(
		(value) =>
			!value.start ||
			!value.end ||
			value.start <= value.end || { path: ["end"], issue: "End date must not precede start date." },
	),
);
export const SprintIdentitySchema = Schema.Struct({
	...PlanningScopeFields,
	sprintId: required("Sprint"),
});
export const SprintStatusInputSchema = Schema.Struct({
	...SprintIdentitySchema.fields,
	status: Schema.Literals(["planned", "active", "completed"]),
});
export const MoveSprintIssuesSchema = Schema.Struct({
	...PlanningScopeFields,
	sprintId: required("Source sprint"),
	targetId: required("Destination sprint"),
	issueIds: Schema.Array(required("Issue"))
		.pipe(Schema.mutable)
		.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
}).check(
	Schema.makeFilter(
		(value) =>
			value.sprintId !== value.targetId || {
				path: ["targetId"],
				issue: "Choose a different destination sprint.",
			},
	),
);
export const MetricsWindowSchema = Schema.Struct({
	...PlanningScopeFields,
	since: date,
	until: date,
	granularity: Schema.Literals(["day", "week"]),
	heatmapMode: Schema.Literals(["claims", "contention"]),
	prefix: Schema.String.check(Schema.isMaxLength(2000)),
}).check(
	Schema.makeFilter(
		(value) =>
			value.since <= value.until || {
				path: ["until"],
				issue: "To date must not precede From date.",
			},
	),
);

/** Calendar input offset is semantic data, preserving original local-midnight timestamps. */
export function calendarOffset(value: string): number {
	if (!value) return 0;
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year, month - 1, day).getTimezoneOffset();
}
export function calendarTimestamp(value: string, offset: number): number | null {
	return value ? Date.parse(`${value}T00:00:00Z`) / 1000 + offset * 60 : null;
}
