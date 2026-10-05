"use client";
import { Schema } from "effect";
import { useActionState, useEffect, useRef, useState } from "react";
import { createIssue } from "../../actions";
import { BodyText, Priority, RequiredText, Text, TitleText, useIssueForm } from "../../forms";
import { useUnsavedUnloadGuard } from "../../utils/use-unsaved-unload-guard";
import type { ProjectMeta } from "./types";

interface Params {
	workspaceSlug?: string;
	filterProject: string;
	projects: ProjectMeta[];
}

/** Owns the "New issue" modal's form state and submit flow, isolated from the parent list. */
export function useCreateIssueModal({ workspaceSlug, filterProject, projects }: Params) {
	const [showCreateModal, setShowCreateModal] = useState(false);
	const createForm = useIssueForm(
		{
			createTitle: "",
			createBody: "",
			createPriority: "medium",
			createStatusId: "",
			createProjectId: "",
			createTypeId: "",
		},
		Schema.Struct({
			createTitle: TitleText,
			createBody: BodyText,
			createPriority: Priority,
			createStatusId: Text,
			createProjectId: RequiredText,
			createTypeId: Text,
		}),
	);
	const [createTitle, setCreateTitle] = createForm.field("createTitle");
	const [createBody, setCreateBody] = createForm.field("createBody");
	const [createPriority, setCreatePriority] = createForm.field("createPriority");
	const [createStatusId, setCreateStatusId] = createForm.field("createStatusId");
	const [createProjectId, setCreateProjectId] = createForm.field("createProjectId");
	const [createTypeId, setCreateTypeId] = createForm.field("createTypeId");
	const [result, submitCreate, submittingCreate] = useActionState(createIssue, null);
	const openedResult = useRef(result);
	const createError =
		result && result !== openedResult.current && !result.ok
			? `Failed to create issue: ${result.message}`
			: null;
	useEffect(() => {
		if (result?.ok) setShowCreateModal(false);
	}, [result]);
	useUnsavedUnloadGuard(showCreateModal && Boolean(createTitle.trim() || createBody.trim()));

	// Escape closes the create modal
	useEffect(() => {
		if (!showCreateModal) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setShowCreateModal(false);
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [showCreateModal]);

	function openCreateModal() {
		const targetProjectId = filterProject
			? (projects.find((p) => p.key === filterProject)?.id ?? projects[0]?.id ?? "")
			: (projects[0]?.id ?? "");
		setCreateProjectId(targetProjectId);
		setCreateTitle("");
		setCreateBody("");
		setCreatePriority("medium");
		setCreateStatusId("");
		setCreateTypeId("");
		openedResult.current = result;
		setShowCreateModal(true);
	}

	return {
		workspaceSlug,
		createValid: createForm.isValid,
		showCreateModal,
		setShowCreateModal,
		createTitle,
		setCreateTitle,
		createBody,
		setCreateBody,
		createPriority,
		setCreatePriority,
		createStatusId,
		setCreateStatusId,
		createProjectId,
		setCreateProjectId,
		createTypeId,
		setCreateTypeId,
		submittingCreate,
		createError,
		openCreateModal,
		submitCreate,
	};
}
