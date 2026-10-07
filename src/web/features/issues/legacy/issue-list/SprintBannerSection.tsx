"use client";
import { Schema } from "effect";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { unwrapResult } from "../../../../client/functions";
import { Button } from "../../../../components/ui/Button";
import { formatTimestampDate } from "../../../timestamp";
import { updateSprint } from "../../actions";
import { RequiredText, Text, useIssueForm } from "../../forms";
import { dateInputToUnix, unixToDateInput } from "../../utils/date-input";
import type { Issue } from "../board-utils";

export interface SprintDetail {
	id: string;
	name: string;
	status: "planned" | "active" | "completed";
	startDate: number | null;
	endDate: number | null;
	goal: string | null;
	projectId: string;
}

const tsToDateInput = unixToDateInput;

function sprintStatusStyle(status: SprintDetail["status"]): {
	background: string;
	color: string;
	borderColor: string;
} {
	if (status === "active") {
		return {
			background: "var(--sprint-active-bg)",
			color: "var(--status-in-progress)",
			borderColor: "var(--sprint-active-border)",
		};
	}
	if (status === "completed") {
		return {
			background: "var(--sprint-completed-bg)",
			color: "var(--status-done)",
			borderColor: "var(--sprint-completed-border)",
		};
	}
	return { background: "var(--surface)", color: "var(--text-muted)", borderColor: "var(--border)" };
}

function SprintProgress({ issues }: { issues: Issue[] }) {
	const doneCount = issues.filter((i) => i.status_category === "done").length;
	const totalCount = issues.length;
	if (totalCount === 0) return null;
	const pct = Math.round((doneCount / totalCount) * 100);
	return (
		<div className="mt-2">
			<div className="flex justify-between text-[0.72rem] text-text-muted mb-1">
				<span>
					{doneCount}/{totalCount} done
				</span>
				<span>{pct}%</span>
			</div>
			<div className="h-1.5 bg-bg rounded-full overflow-hidden border border-border">
				<div
					className="h-full rounded-full transition-[width] duration-300 bg-accent"
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}

interface SprintBannerProps {
	sprintDetail: SprintDetail;
	sprintEditing: boolean;
	setSprintEditing: Dispatch<SetStateAction<boolean>>;
	sprintEditName: string;
	setSprintEditName: Dispatch<SetStateAction<string>>;
	sprintEditGoal: string;
	setSprintEditGoal: Dispatch<SetStateAction<string>>;
	sprintEditStatus: "planned" | "active" | "completed";
	setSprintEditStatus: Dispatch<SetStateAction<"planned" | "active" | "completed">>;
	sprintEditStart: string;
	setSprintEditStart: Dispatch<SetStateAction<string>>;
	sprintEditEnd: string;
	setSprintEditEnd: Dispatch<SetStateAction<string>>;
	sprintEditSaving: boolean;
	sprintEditError: string | null;
	saveSprintEdit: (e: import("react").FormEvent<HTMLFormElement>) => void;
	openSprintEdit: () => void;
	setFilterSprintId: Dispatch<SetStateAction<string>>;
	issues: Issue[];
}

const SPRINT_EDIT_INPUT_CLASS = [
	"px-2 py-[0.3rem] border border-border rounded text-sm bg-bg text-text-base",
	"font-normal normal-case tracking-normal mt-[0.2rem]",
].join(" ");

function SprintEditFields({
	sprintEditName,
	setSprintEditName,
	sprintEditStatus,
	setSprintEditStatus,
	sprintEditStart,
	setSprintEditStart,
	sprintEditEnd,
	setSprintEditEnd,
}: Pick<
	SprintBannerProps,
	| "sprintEditName"
	| "setSprintEditName"
	| "sprintEditStatus"
	| "setSprintEditStatus"
	| "sprintEditStart"
	| "setSprintEditStart"
	| "sprintEditEnd"
	| "setSprintEditEnd"
>) {
	return (
		<div className="flex gap-3 flex-wrap items-end">
			<div className="flex-1 min-w-[160px]">
				<label className="block text-[0.72rem] font-semibold text-text-muted uppercase tracking-[0.04em]">
					Name *
					<input
						type="text"
						value={sprintEditName}
						onInput={(e) => setSprintEditName((e.target as HTMLInputElement).value)}
						required
						maxLength={255}
						className={`w-full ${SPRINT_EDIT_INPUT_CLASS}`}
					/>
				</label>
			</div>
			<div>
				<label className="block text-[0.72rem] font-semibold text-text-muted uppercase tracking-[0.04em]">
					Status
					<select
						value={sprintEditStatus}
						onChange={(e) =>
							setSprintEditStatus(
								(e.target as HTMLSelectElement).value as "planned" | "active" | "completed",
							)
						}
						className={`cursor-pointer ${SPRINT_EDIT_INPUT_CLASS}`}
					>
						<option value="planned">Planned</option>
						<option value="active">Active</option>
						<option value="completed">Completed</option>
					</select>
				</label>
			</div>
			<div>
				<label className="block text-[0.72rem] font-semibold text-text-muted uppercase tracking-[0.04em]">
					Start date
					<input
						type="date"
						value={sprintEditStart}
						onInput={(e) => setSprintEditStart((e.target as HTMLInputElement).value)}
						className={SPRINT_EDIT_INPUT_CLASS}
					/>
				</label>
			</div>
			<div>
				<label className="block text-[0.72rem] font-semibold text-text-muted uppercase tracking-[0.04em]">
					End date
					<input
						type="date"
						value={sprintEditEnd}
						onInput={(e) => setSprintEditEnd((e.target as HTMLInputElement).value)}
						className={SPRINT_EDIT_INPUT_CLASS}
					/>
				</label>
			</div>
		</div>
	);
}

function SprintEditForm({
	sprintEditName,
	setSprintEditName,
	sprintEditGoal,
	setSprintEditGoal,
	sprintEditStatus,
	setSprintEditStatus,
	sprintEditStart,
	setSprintEditStart,
	sprintEditEnd,
	setSprintEditEnd,
	sprintEditSaving,
	sprintEditError,
	saveSprintEdit,
	setSprintEditing,
}: Omit<
	SprintBannerProps,
	"sprintDetail" | "openSprintEdit" | "setFilterSprintId" | "issues" | "sprintEditing"
>) {
	return (
		<form onSubmit={saveSprintEdit}>
			{sprintEditError && (
				<p role="alert" className="text-danger-text text-sm mb-2">
					{sprintEditError}
				</p>
			)}
			<div className="flex flex-col gap-3">
				<SprintEditFields
					sprintEditName={sprintEditName}
					setSprintEditName={setSprintEditName}
					sprintEditStatus={sprintEditStatus}
					setSprintEditStatus={setSprintEditStatus}
					sprintEditStart={sprintEditStart}
					setSprintEditStart={setSprintEditStart}
					sprintEditEnd={sprintEditEnd}
					setSprintEditEnd={setSprintEditEnd}
				/>
				<div>
					<label className="block text-[0.72rem] font-semibold text-text-muted uppercase tracking-[0.04em]">
						Goal
						<input
							type="text"
							value={sprintEditGoal}
							onInput={(e) => setSprintEditGoal((e.target as HTMLInputElement).value)}
							maxLength={2000}
							placeholder="What do you want to achieve this sprint?"
							className={`w-full ${SPRINT_EDIT_INPUT_CLASS}`}
						/>
					</label>
				</div>
				<div className="flex gap-2">
					<Button
						type="submit"
						variant="primary"
						size="sm"
						disabled={sprintEditSaving || !sprintEditName.trim()}
					>
						{sprintEditSaving ? "Saving…" : "Save"}
					</Button>
					<Button type="button" variant="outline" size="sm" onClick={() => setSprintEditing(false)}>
						Cancel
					</Button>
				</div>
			</div>
		</form>
	);
}

function SprintBannerView({
	sprintDetail,
	openSprintEdit,
	setFilterSprintId,
	issues,
}: Pick<SprintBannerProps, "sprintDetail" | "openSprintEdit" | "setFilterSprintId" | "issues">) {
	return (
		<>
			<div className="flex items-center gap-2 flex-wrap">
				<span className="font-semibold text-text-base">{sprintDetail.name}</span>
				<span
					className="text-[0.72rem] font-semibold px-2 py-0.5 rounded-full capitalize border"
					style={sprintStatusStyle(sprintDetail.status)}
				>
					{sprintDetail.status}
				</span>
				{sprintDetail.startDate && (
					<span className="text-sm text-text-muted">
						{formatTimestampDate(sprintDetail.startDate)}
						{" – "}
						{sprintDetail.endDate ? formatTimestampDate(sprintDetail.endDate) : "ongoing"}
					</span>
				)}
				<button
					type="button"
					onClick={openSprintEdit}
					className={[
						"py-[0.2rem] px-2 rounded border border-border bg-bg text-text-muted cursor-pointer",
						"text-[0.78rem] hover:text-text-base",
					].join(" ")}
				>
					Edit
				</button>
				<button
					type="button"
					onClick={() => setFilterSprintId("")}
					className="ml-auto py-[0.2rem] px-2 rounded border border-border bg-bg text-text-muted cursor-pointer text-[0.78rem]"
				>
					✕ Clear sprint
				</button>
			</div>
			{sprintDetail.goal && <p className="mt-1 text-sm text-text-muted m-0">{sprintDetail.goal}</p>}
			<SprintProgress issues={issues} />
		</>
	);
}

function SprintBanner(props: SprintBannerProps) {
	return (
		<div className="mb-4 px-[0.875rem] py-[0.625rem] bg-surface border border-border rounded-md">
			{props.sprintEditing ? <SprintEditForm {...props} /> : <SprintBannerView {...props} />}
		</div>
	);
}

interface SprintBannerSectionProps {
	filterSprintId: string;
	sprintDetail: SprintDetail | null;
	setFilterSprintId: Dispatch<SetStateAction<string>>;
	workspaceSlug?: string;
	issues: Issue[];
}

/** Wraps SprintBanner with its own edit-form state, isolated from the parent list. */
export default function SprintBannerSection({
	filterSprintId,
	sprintDetail,
	setFilterSprintId,
	workspaceSlug,
	issues,
}: SprintBannerSectionProps) {
	const [sprintEditing, setSprintEditing] = useState(false);
	const sprintForm = useIssueForm(
		{
			name: "",
			goal: "",
			status: "planned" as "planned" | "active" | "completed",
			start: "",
			end: "",
		},
		Schema.Struct({
			name: RequiredText.check(Schema.isMaxLength(255)),
			goal: Text.check(Schema.isMaxLength(2000)),
			status: Schema.Literals(["planned", "active", "completed"]),
			start: Text,
			end: Text,
		}),
	);
	const [sprintEditName, setSprintEditName] = sprintForm.field("name");
	const [sprintEditGoal, setSprintEditGoal] = sprintForm.field("goal");
	const [sprintEditStatus, setSprintEditStatus] = sprintForm.field("status");
	const [sprintEditStart, setSprintEditStart] = sprintForm.field("start");
	const [sprintEditEnd, setSprintEditEnd] = sprintForm.field("end");
	const [sprintEditSaving, setSprintEditSaving] = useState(false);
	const [sprintEditError, setSprintEditError] = useState<string | null>(null);

	function openSprintEdit() {
		if (!sprintDetail) return;
		setSprintEditName(sprintDetail.name);
		setSprintEditGoal(sprintDetail.goal ?? "");
		setSprintEditStatus(sprintDetail.status);
		setSprintEditStart(sprintDetail.startDate ? tsToDateInput(sprintDetail.startDate) : "");
		setSprintEditEnd(sprintDetail.endDate ? tsToDateInput(sprintDetail.endDate) : "");
		setSprintEditError(null);
		setSprintEditing(true);
	}

	async function saveSprintEdit(e: import("react").FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!sprintDetail) return;
		if (!(await sprintForm.validate())) {
			setSprintEditError("Enter a sprint name.");
			return;
		}
		setSprintEditSaving(true);
		setSprintEditError(null);
		try {
			const body = {
				name: sprintEditName.trim(),
				goal: sprintEditGoal.trim() || null,
				status: sprintEditStatus,
				startDate: dateInputToUnix(sprintEditStart),
				endDate: dateInputToUnix(sprintEditEnd),
			};
			unwrapResult(await updateSprint({ sprintId: sprintDetail.id, workspaceSlug, patch: body }));

			setSprintEditing(false);
		} catch (err) {
			setSprintEditError(String(err));
		} finally {
			setSprintEditSaving(false);
		}
	}

	if (!filterSprintId || !sprintDetail) return null;

	return (
		<SprintBanner
			sprintDetail={sprintDetail}
			sprintEditing={sprintEditing}
			setSprintEditing={setSprintEditing}
			sprintEditName={sprintEditName}
			setSprintEditName={setSprintEditName}
			sprintEditGoal={sprintEditGoal}
			setSprintEditGoal={setSprintEditGoal}
			sprintEditStatus={sprintEditStatus}
			setSprintEditStatus={setSprintEditStatus}
			sprintEditStart={sprintEditStart}
			setSprintEditStart={setSprintEditStart}
			sprintEditEnd={sprintEditEnd}
			setSprintEditEnd={setSprintEditEnd}
			sprintEditSaving={sprintEditSaving}
			sprintEditError={sprintEditError}
			saveSprintEdit={saveSprintEdit}
			openSprintEdit={openSprintEdit}
			setFilterSprintId={setFilterSprintId}
			issues={issues}
		/>
	);
}
