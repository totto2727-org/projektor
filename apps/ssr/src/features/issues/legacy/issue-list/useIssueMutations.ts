"use client";
import { useState } from "react";
import { unwrapResult } from "../../../../client/functions";
import { updateIssue } from "../../actions";
import type { TaskStatus } from "../board-utils";

/** Mutation proxies refresh canonical SSR rows, never rewrite a browser-owned row copy. */
export function useIssueMutations(
	workspaceSlug: string | undefined,
	statuses: readonly TaskStatus[]
) {
	const [updatingId, setUpdatingId] = useState<string | null>(null);
	const [updatingPriorityId, setUpdatingPriorityId] = useState<string | null>(null);
	const [updateError, setUpdateError] = useState<string | null>(null);

	async function changeStatus(issueId: string, statusId: string) {
		if (!statuses.some((status) => status.id === statusId)) return;
		setUpdateError(null);
		setUpdatingId(issueId);
		try {
			unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { statusId } }));
		} catch (cause) {
			setUpdateError(`Status update failed: ${String(cause)}`);
		} finally {
			setUpdatingId(null);
		}
	}

	async function changePriority(issueId: string, priority: string) {
		setUpdateError(null);
		setUpdatingPriorityId(issueId);
		try {
			unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { priority } }));
		} catch (cause) {
			setUpdateError(`Priority update failed: ${String(cause)}`);
		} finally {
			setUpdatingPriorityId(null);
		}
	}
	return { updatingId, updatingPriorityId, updateError, changeStatus, changePriority };
}
