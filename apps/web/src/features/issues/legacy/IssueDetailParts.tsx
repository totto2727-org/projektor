"use client";
import { query as serverQuery } from "@effront/core/query";
import { Effect, Schema } from "effect";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { unwrapResult } from "../../../client/functions";
import { AttachmentUpload } from "../../../components/AttachmentUpload";
import { Button } from "../../../components/ui/Button";
import Select from "../../../components/ui/Select";
import {
	addAttachmentLink,
	addComment,
	addIssueLink,
	deleteComment,
	deleteAttachment as deleteIssueAttachment,
	deleteIssueLink,
	editComment,
	readIssue,
	searchWikiAttachments,
	shareIssue,
	updateIssue,
} from "../actions";
import {
	BodyText,
	CommentText,
	IssueReference,
	PointsText,
	Text,
	TitleText,
	UrlText,
	useIssueForm,
} from "../forms";
import { formatIssueRef, normalizeIssueRef } from "../lib/issue-ref";
import { parseStoryPoints } from "../lib/story-points";
import { clearDraft, draftKey, loadDraft, saveDraft } from "../utils/drafts";
import { issueUrl } from "../utils/issue-url";
import { PRIORITY_OPTIONS } from "../utils/issue-utils";
import { MarkdownPreview } from "../../../components/markdown/MarkdownPreview";
import { useUnsavedUnloadGuard } from "../utils/use-unsaved-unload-guard";
import { categoryColor } from "./board-utils";
import type {
	Attachment,
	Comment,
	IssueData,
	IssueLink,
	Member,
	TaskStatus,
	TaskType,
} from "./issue-detail-helpers";
import {
	formatBytes,
	formatDate,
	LINK_TYPE_LABELS,
	LINK_TYPE_OPTIONS,
	PRIORITY_COLORS,
	relativeTime,
} from "./issue-detail-helpers";
import MarkdownEditor from "./LazyMarkdownEditor";

const PencilIcon = () => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<title>Edit</title>
		<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
		<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
	</svg>
);

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3 mb-4">
			<span className="text-[0.7rem] font-semibold uppercase tracking-wider text-text-muted whitespace-nowrap">
				{title}
			</span>
			<div className="flex-1 h-px bg-border" />
		</div>
	);
}

function SidebarField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-start gap-2 py-2">
			<span className="text-[0.7rem] font-medium uppercase tracking-wider text-text-muted w-[4.5rem] shrink-0 pt-[0.2rem]">
				{label}
			</span>
			<div className="flex-1 min-w-0">{children}</div>
		</div>
	);
}

export function RefChip({ issueRef, copyUrl }: { issueRef: string; copyUrl: string }) {
	const [copiedRef, setCopiedRef] = useState(false);

	function copyLink() {
		navigator.clipboard.writeText(new URL(copyUrl, window.location.origin).href).catch(() => {});
		setCopiedRef(true);
		setTimeout(() => setCopiedRef(false), 2000);
	}

	return (
		<button
			type="button"
			onClick={copyLink}
			title={copiedRef ? "Copied!" : "Copy link"}
			className="font-mono text-xs font-semibold px-2 py-[0.2rem] rounded bg-surface border
				border-border text-text-muted inline-flex items-center gap-1.5 cursor-pointer
				hover:text-text-base transition-colors"
		>
			{issueRef}
			{copiedRef ? (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<title>Copied</title>
					<polyline points="20 6 9 17 4 12" />
				</svg>
			) : (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<title>Copy</title>
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</svg>
			)}
		</button>
	);
}

export function ShareButton({
	issueId,
	workspaceSlug,
}: {
	issueId: string;
	workspaceSlug?: string;
}) {
	const [shareUrl, setShareUrl] = useState<string | null>(null);
	const [sharingLoading, setSharingLoading] = useState(false);
	const [copiedShare, setCopiedShare] = useState(false);

	async function createShareLink() {
		if (shareUrl) {
			setShareUrl(null);
			return;
		}
		setSharingLoading(true);
		try {
			const data = unwrapResult(await shareIssue({ workspaceSlug, issueId }));
			setShareUrl(`${window.location.origin}${data.url}`);
		} catch {
			// non-fatal
		} finally {
			setSharingLoading(false);
		}
	}

	function copyShareUrl() {
		if (!shareUrl) return;
		navigator.clipboard.writeText(shareUrl).catch(() => {});
		setCopiedShare(true);
		setTimeout(() => setCopiedShare(false), 2000);
	}

	return (
		<div className="relative">
			<Button
				onClick={createShareLink}
				disabled={sharingLoading}
				variant="outline"
				size="sm"
				title="Share issue"
			>
				{sharingLoading ? "…" : "Share"}
			</Button>
			{shareUrl && (
				<div
					className="absolute left-0 top-full mt-1 z-50 bg-bg border border-border rounded-md
						shadow-elevation-sm p-3 w-72"
				>
					<p className="text-xs text-text-muted mb-2">Share link · Expires in 3 days</p>
					<div className="flex items-center gap-1">
						<input
							type="text"
							readOnly
							value={shareUrl}
							className="flex-1 text-xs bg-surface border border-border rounded px-2 py-1 font-mono truncate"
						/>
						<Button
							onClick={copyShareUrl}
							variant="outline"
							size="sm"
							className="shrink-0"
							title={copiedShare ? "Copied!" : "Copy"}
						>
							{copiedShare ? "✓" : "Copy"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

export function ParentBadge({ parentEpic }: { parentEpic: IssueData | null }) {
	if (!parentEpic) return null;
	const isEpic = parentEpic.type_key === "epic";
	const ref = parentEpic.project_key
		? `${parentEpic.project_key}-${parentEpic.number}`
		: `#${parentEpic.number}`;
	return (
		<a
			href={issueUrl(
				parentEpic.project_key,
				parentEpic.number,
				parentEpic.title,
				parentEpic.id,
				parentEpic.workspaceSlug,
			)}
			className={`inline-flex items-center gap-1 px-2 py-[0.125rem] rounded no-underline text-xs font-medium border ${
				isEpic
					? "bg-epic-bg text-epic-text border-epic-border"
					: "bg-surface text-text-muted border-border"
			}`}
		>
			<span>{isEpic ? "⬡" : "↑"}</span>
			<span>
				{parentEpic.type_name ?? "Parent"}: {ref} {parentEpic.title}
			</span>
		</a>
	);
}

export function TitleSection({
	issue,
	issueId,
	workspaceSlug,
}: {
	issue: IssueData;
	issueId: string;
	workspaceSlug?: string;
}) {
	const [editingTitle, setEditingTitle] = useState(false);
	const titleForm = useIssueForm({ title: "" }, Schema.Struct({ title: TitleText }));
	const [editTitle, setEditTitle] = titleForm.field("title");
	const [savingTitle, setSavingTitle] = useState(false);
	const [saveTitleError, setSaveTitleError] = useState<string | null>(null);
	useUnsavedUnloadGuard(editingTitle && editTitle !== issue.title);

	function startEditTitle() {
		setEditTitle(issue.title);
		setSaveTitleError(null);
		setEditingTitle(true);
	}

	function cancelEditTitle() {
		setEditingTitle(false);
		setSaveTitleError(null);
	}

	async function saveTitle() {
		if (!(await titleForm.validate())) {
			setSaveTitleError("Enter a title.");
			return;
		}
		setSavingTitle(true);
		setSaveTitleError(null);
		try {
			unwrapResult(
				await updateIssue({ workspaceSlug, issueId, patch: { title: editTitle.trim() } }),
			);
			setEditingTitle(false);
		} catch (e) {
			setSaveTitleError(`Save failed: ${String(e)}`);
		} finally {
			setSavingTitle(false);
		}
	}

	if (editingTitle) {
		return (
			<div>
				{saveTitleError && (
					<p role="alert" className="text-danger-text mb-2 text-sm">
						{saveTitleError}
					</p>
				)}
				<input
					type="text"
					value={editTitle}
					onInput={(e) => setEditTitle((e.target as HTMLInputElement).value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") saveTitle();
						if (e.key === "Escape") cancelEditTitle();
					}}
					disabled={savingTitle}
					// biome-ignore lint/a11y/noAutofocus: intentional focus when the inline editor opens
					autoFocus
					className="w-full text-2xl font-bold text-text-base bg-bg border border-border rounded-md px-3
						py-1.5 mb-2 focus:outline-hidden focus:ring-1 focus:ring-accent"
				/>
				<div className="flex gap-2">
					<Button onClick={saveTitle} disabled={savingTitle} variant="primary" size="sm">
						{savingTitle ? "Saving…" : "Save"}
					</Button>
					<Button onClick={cancelEditTitle} disabled={savingTitle} variant="outline" size="sm">
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="group flex items-start gap-2">
			<h1
				className="m-0 text-2xl font-bold text-text-base leading-tight cursor-pointer"
				onClick={startEditTitle}
				onKeyDown={(e) => {
					if (e.key === "Enter") startEditTitle();
				}}
				title="Click to edit title"
			>
				{issue.title}
			</h1>
			<button
				type="button"
				onClick={startEditTitle}
				title="Edit title"
				className="shrink-0 mt-[0.35rem] text-text-muted opacity-0 group-hover:opacity-100
					transition-opacity rounded p-0.5 hover:text-text-base"
			>
				<PencilIcon />
			</button>
		</div>
	);
}

function useBodyEditor(
	issue: IssueData,
	issueId: string,
	workspaceSlug: string | undefined,
	currentUserId: string | null,
) {
	const [editingBody, setEditingBody] = useState(false);
	const bodyForm = useIssueForm({ body: "" }, Schema.Struct({ body: BodyText }));
	const [editBody, setEditBody] = bodyForm.field("body");
	const [savingBody, setSavingBody] = useState(false);
	const [saveBodyError, setSaveBodyError] = useState<string | null>(null);
	useUnsavedUnloadGuard(editingBody && editBody !== (issue.body ?? ""));
	const key = draftKey(workspaceSlug, `${currentUserId ?? "-"}:${issueId}`, "body");
	const [hasDraft, setHasDraft] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);

	// Surface an unsaved edit from a previous visit, rather than silently reopening the
	// editor — the user may have moved on, and the issue may have changed since.
	useEffect(() => {
		setHasDraft(loadDraft(key) !== null);
	}, [key]);

	function startEditBody(fromDraft = false) {
		setEditBody((fromDraft ? loadDraft(key) : null) ?? issue.body ?? "");
		setSaveBodyError(null);
		setEditingBody(true);
	}

	function updateBody(value: string) {
		setEditBody(value);
		saveDraft(key, value);
		setHasDraft(!!value.trim());
	}

	function cancelEditBody() {
		setEditingBody(false);
		setSaveBodyError(null);
		clearDraft(key);
		setHasDraft(false);
	}

	async function saveBody() {
		if (!(await bodyForm.validate())) return;
		setSavingBody(true);
		setSaveBodyError(null);
		try {
			unwrapResult(await updateIssue({ workspaceSlug, issueId, patch: { body: editBody } }));
			// Only discard once the server has it — a failed save keeps the text.
			clearDraft(key);
			setHasDraft(false);
			setEditingBody(false);
		} catch (e) {
			setSaveBodyError(`Save failed: ${String(e)}`);
		} finally {
			setSavingBody(false);
		}
	}

	return {
		editingBody,
		editBody,
		savingBody,
		saveBodyError,
		hasDraft,
		bodyRef,
		startEditBody,
		updateBody,
		cancelEditBody,
		saveBody,
	};
}

function BodyEditForm({
	editBody,
	updateBody,
	saveBody,
	cancelEditBody,
	savingBody,
}: {
	editBody: string;
	updateBody: (value: string) => void;
	saveBody: () => void;
	cancelEditBody: () => void;
	savingBody: boolean;
}) {
	return (
		<div>
			<div className="mb-2">
				<MarkdownEditor value={editBody} onChange={updateBody} minHeight="240px" />
			</div>
			<div className="flex gap-2">
				<Button onClick={saveBody} disabled={savingBody} variant="primary">
					{savingBody ? "Saving…" : "Save"}
				</Button>
				<Button onClick={cancelEditBody} disabled={savingBody} variant="outline">
					Cancel
				</Button>
			</div>
		</div>
	);
}

export function BodySection({
	issue,
	issueId,
	workspaceSlug,
	currentUserId,
}: {
	issue: IssueData;
	issueId: string;
	workspaceSlug?: string;
	currentUserId: string | null;
}) {
	const {
		editingBody,
		editBody,
		savingBody,
		saveBodyError,
		hasDraft,
		bodyRef,
		startEditBody,
		updateBody,
		cancelEditBody,
		saveBody,
	} = useBodyEditor(issue, issueId, workspaceSlug, currentUserId);

	return (
		<section className="mb-8">
			<div className="flex items-center gap-3 mb-4">
				<span className="text-[0.7rem] font-semibold uppercase tracking-wider text-text-muted whitespace-nowrap">
					Description
				</span>
				<div className="flex-1 h-px bg-border" />
				{!editingBody && (
					<button
						type="button"
						onClick={() => startEditBody()}
						title="Edit description"
						className="text-text-muted hover:text-text-base transition-colors rounded p-0.5"
					>
						<PencilIcon />
					</button>
				)}
			</div>

			{saveBodyError && (
				<p role="alert" className="text-danger-text mb-2 text-sm">
					{saveBodyError}
				</p>
			)}

			{!editingBody && hasDraft && (
				<p className="mb-3 text-sm text-text-muted">
					You have an unsaved description edit.{" "}
					<button
						type="button"
						onClick={() => startEditBody(true)}
						className="underline bg-transparent border-0 p-0 text-inherit cursor-pointer font-[inherit]"
					>
						Resume editing
					</button>
				</p>
			)}

			{editingBody ? (
				<BodyEditForm
					editBody={editBody}
					updateBody={updateBody}
					saveBody={saveBody}
					cancelEditBody={cancelEditBody}
					savingBody={savingBody}
				/>
			) : issue.body ? (
				<MarkdownPreview
					content={issue.body}
					initial={issue.renderedBody}
					className="break-words"
				/>
			) : (
				<p className="text-text-muted italic">No description.</p>
			)}
		</section>
	);
}

export function ChildIssuesSection({
	issue,
	childIssues,
}: {
	issue: IssueData;
	childIssues: IssueData[];
}) {
	if (issue.type_key !== "epic") return null;

	return (
		<section className="mb-8">
			<div className="flex items-center gap-3 mb-4">
				<span className="text-[0.7rem] font-semibold uppercase tracking-wider text-text-muted whitespace-nowrap">
					Child issues{childIssues.length > 0 && ` (${childIssues.length})`}
				</span>
				{issue.rollup && issue.rollup.total > 0 && (
					<span className="text-xs text-text-muted whitespace-nowrap">
						{issue.rollup.done} done · {issue.rollup.remaining} remaining
					</span>
				)}
				<div className="flex-1 h-px bg-border" />
			</div>
			{childIssues.length === 0 ? (
				<p className="text-text-muted italic">No child issues yet.</p>
			) : (
				<div className="flex flex-col gap-2">
					{childIssues.map((child) => {
						const childRef = child.project_key
							? `${child.project_key}-${child.number}`
							: `#${child.number}`;
						return (
							<div
								key={child.id}
								className="flex items-center gap-[0.625rem] px-3 py-2 border border-border rounded-md bg-surface flex-wrap"
							>
								<span className="font-mono text-[0.8rem] text-text-muted shrink-0">{childRef}</span>
								<a
									href={issueUrl(
										child.project_key,
										child.number,
										child.title,
										child.id,
										child.workspaceSlug,
									)}
									className="text-text-base no-underline text-sm flex-1 min-w-0 truncate hover:underline"
								>
									{child.title}
								</a>
								{child.status_category && (
									<span
										className="px-2 py-[0.125rem] rounded text-xs font-medium border border-border shrink-0"
										style={{ color: categoryColor(child.status_category) }}
									>
										{child.status_name ?? child.status_category.replace("_", " ")}
									</span>
								)}
								{child.priority && child.priority !== "none" && (
									<span
										className="px-2 py-[0.125rem] rounded text-xs font-medium shrink-0 capitalize"
										style={{
											background: `var(--priority-${child.priority}-bg)`,
											color: `var(--priority-${child.priority}-text)`,
										}}
									>
										{child.priority}
									</span>
								)}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

function LinkItem({
	link,
	onRemove,
	workspaceSlug,
}: {
	link: IssueLink;
	onRemove: () => void;
	workspaceSlug?: string;
}) {
	const ref = formatIssueRef(link.linkedIssueProjectKey, link.linkedIssueNumber);
	return (
		<span
			className="inline-flex items-center gap-[0.375rem] px-2 py-1 border border-border
				rounded-md bg-surface text-[0.8rem]"
		>
			<a
				href={issueUrl(
					link.linkedIssueProjectKey,
					link.linkedIssueNumber,
					link.linkedIssueTitle,
					link.linkedIssueId,
					workspaceSlug,
				)}
				className="text-accent no-underline inline-flex items-center gap-[0.375rem]"
			>
				<span className="font-mono text-text-muted">{ref}</span>
				<span className="text-text-base">{link.linkedIssueTitle}</span>
				{link.linkedIssueStatusCategory && (
					<span
						className="px-[0.375rem] py-[0.0625rem] rounded-[3px] text-[0.7rem] bg-priority-low-bg font-medium"
						style={{ color: categoryColor(link.linkedIssueStatusCategory) }}
					>
						{link.linkedIssueStatusCategory.replace("_", " ")}
					</span>
				)}
			</a>
			<Button
				onClick={onRemove}
				aria-label={`Remove ${ref} link`}
				size="sm"
				className="bg-transparent border-none text-text-muted px-[0.125rem] leading-none"
			>
				×
			</Button>
		</span>
	);
}

function LinkForm({
	linkFormType,
	setLinkFormType,
	linkFormRef,
	setLinkFormRef,
	linkFormError,
	setLinkFormError,
	addingLink,
	onAdd,
	onCancel,
}: {
	linkFormType: string;
	setLinkFormType: (v: string) => void;
	linkFormRef: string;
	setLinkFormRef: (v: string) => void;
	linkFormError: string | null;
	setLinkFormError: (v: string | null) => void;
	addingLink: boolean;
	onAdd: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="flex flex-wrap gap-2 items-start max-sm:flex-col">
			<Select
				ariaLabel="Link type"
				value={linkFormType}
				onChange={setLinkFormType}
				options={LINK_TYPE_OPTIONS}
			/>
			<input
				type="text"
				value={linkFormRef}
				onInput={(e) => {
					setLinkFormRef((e.target as HTMLInputElement).value);
					setLinkFormError(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") onAdd();
					if (e.key === "Escape") onCancel();
				}}
				placeholder="PROJ-12"
				// biome-ignore lint/a11y/noAutofocus: intentional focus when the inline editor opens
				autoFocus
				className="px-[0.625rem] py-[0.375rem] border border-border rounded text-sm w-28 max-sm:w-full bg-bg text-text-base"
			/>
			<Button onClick={onAdd} disabled={addingLink} variant="primary">
				{addingLink ? "Adding…" : "Add"}
			</Button>
			<Button onClick={onCancel} variant="outline">
				Cancel
			</Button>
			{linkFormError && (
				<span role="alert" className="text-[0.8rem] text-danger-text self-center">
					{linkFormError}
				</span>
			)}
		</div>
	);
}

export function RelationsSection({
	issueId,
	workspaceSlug,
	links,
}: {
	issueId: string;
	workspaceSlug?: string;
	links: IssueLink[];
}) {
	const [linkFormOpen, setLinkFormOpen] = useState(false);
	const relationForm = useIssueForm(
		{ type: "relates_to", ref: "" },
		Schema.Struct({
			type: Schema.Literals(["blocked_by", "blocks", "relates_to", "duplicates"]),
			ref: IssueReference,
		}),
	);
	const [linkFormType, setLinkFormType] = relationForm.field("type");
	const [linkFormRef, setLinkFormRef] = relationForm.field("ref");
	const [addingLink, setAddingLink] = useState(false);
	const [linkFormError, setLinkFormError] = useState<string | null>(null);

	const linksByType = (["blocked_by", "blocks", "relates_to", "duplicates"] as const)
		.map((type) => ({
			type,
			label: LINK_TYPE_LABELS[type],
			items: links.filter((l) => l.type === type),
		}))
		.filter((g) => g.items.length > 0);

	async function addLink() {
		const ref = normalizeIssueRef(linkFormRef);
		setLinkFormRef(ref);
		if (!(await relationForm.validate())) {
			setLinkFormError("Format must be KEY-NUMBER (e.g. PROJ-12)");
			return;
		}

		setAddingLink(true);
		setLinkFormError(null);
		try {
			let resolved: { id: string };
			try {
				resolved = unwrapResult(
					await Effect.runPromise(serverQuery(readIssue)({ issueId: ref, workspaceSlug })),
				);
			} catch {
				setLinkFormError(`Issue ${ref} not found`);
				return;
			}

			const type = await Effect.runPromise(
				Schema.decodeUnknownEffect(
					Schema.Literals(["blocks", "blocked_by", "relates_to", "duplicates"]),
				)(linkFormType),
			);
			unwrapResult(
				await addIssueLink({ workspaceSlug, issueId, targetIssueId: resolved.id, type }),
			);
			setLinkFormRef("");
			setLinkFormOpen(false);
		} catch (e) {
			setLinkFormError(String(e));
		} finally {
			setAddingLink(false);
		}
	}

	async function removeLink(linkId: string) {
		try {
			unwrapResult(await deleteIssueLink({ workspaceSlug, issueId, linkId }));
		} catch {
			// non-fatal
		}
	}

	return (
		<section className="mb-8">
			<SectionDivider title={`Relations${links.length > 0 ? ` (${links.length})` : ""}`} />

			{linksByType.length > 0 && (
				<div className="mb-4">
					{linksByType.map((group) => (
						<div key={group.type} className="mb-3">
							<p className="m-0 mb-[0.375rem] text-xs font-semibold text-text-muted uppercase tracking-[0.04em]">
								{group.label}
							</p>
							<div className="flex flex-wrap gap-2">
								{group.items.map((link) => (
									<LinkItem
										key={link.id}
										link={link}
										workspaceSlug={workspaceSlug}
										onRemove={() => removeLink(link.id)}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{linkFormOpen ? (
				<LinkForm
					linkFormType={linkFormType}
					setLinkFormType={setLinkFormType}
					linkFormRef={linkFormRef}
					setLinkFormRef={setLinkFormRef}
					linkFormError={linkFormError}
					setLinkFormError={setLinkFormError}
					addingLink={addingLink}
					onAdd={addLink}
					onCancel={() => setLinkFormOpen(false)}
				/>
			) : (
				<button
					type="button"
					onClick={() => setLinkFormOpen(true)}
					className="text-sm text-text-muted hover:text-text-base transition-colors flex items-center gap-1"
				>
					<span className="text-base leading-none">+</span>
					<span>Add relation</span>
				</button>
			)}
		</section>
	);
}

const FileIcon = () => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		className="shrink-0"
	>
		<title>File</title>
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<path d="M14 2v6h6" />
	</svg>
);

const WikiIcon = () => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		className="shrink-0"
	>
		<title>Wiki page</title>
		<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
		<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
	</svg>
);

const LinkIcon = () => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		className="shrink-0"
	>
		<title>External link</title>
		<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
		<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
	</svg>
);

function resolveAttachmentDisplay(
	attachment: Attachment,
	qs: string,
): {
	icon: ReactNode;
	href: string | null;
	label: string;
	meta: string | null;
	external: boolean;
} {
	if (attachment.kind === "wiki_ref" && attachment.wikiPage) {
		return {
			icon: <WikiIcon />,
			href: attachment.wikiPage.url,
			label: attachment.wikiPage.title,
			meta: null,
			external: false,
		};
	}
	if (attachment.kind === "url" && attachment.url) {
		return {
			icon: <LinkIcon />,
			href: attachment.url,
			label: attachment.filename || attachment.url,
			meta: null,
			external: true,
		};
	}
	if (attachment.kind === "file") {
		return {
			icon: <FileIcon />,
			href: `/api/files/${attachment.id}${qs}`,
			label: attachment.filename,
			meta: formatBytes(attachment.size),
			external: true,
		};
	}
	// A wiki_ref whose target page was deleted, or is no longer visible to this
	// user (project access revoked) — the join comes back empty either way.
	return {
		icon: <WikiIcon />,
		href: null,
		label: "Wiki page unavailable",
		meta: null,
		external: false,
	};
}

function AttachmentRow({
	attachment,
	workspaceSlug,
	onDelete,
}: {
	attachment: Attachment;
	workspaceSlug?: string;
	onDelete: () => void;
}) {
	const qs = workspaceSlug ? `?workspace=${workspaceSlug}` : "";
	const { icon, href, label, meta, external } = resolveAttachmentDisplay(attachment, qs);

	return (
		<div className="flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-surface min-h-[44px]">
			<span className="text-text-muted">{icon}</span>
			{href ? (
				<a
					href={href}
					{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
					className="text-accent text-sm no-underline hover:underline flex-1 min-w-0 truncate"
				>
					{label}
				</a>
			) : (
				<span className="text-text-muted text-sm italic flex-1 min-w-0 truncate">{label}</span>
			)}
			{meta && <span className="text-xs text-text-muted shrink-0">{meta}</span>}
			<Button
				onClick={onDelete}
				aria-label={`Remove ${label}`}
				size="sm"
				className="bg-transparent border-none text-text-muted px-[0.125rem] leading-none min-h-[44px] min-w-[44px]"
			>
				×
			</Button>
		</div>
	);
}

function AttachmentUploadForm({
	issueId,
	workspaceSlug,
	onCancel,
}: {
	issueId: string;
	workspaceSlug?: string;
	onCancel: () => void;
}) {
	const selectionForm = useIssueForm({ filename: "" }, Schema.Struct({ filename: Text }));
	const [filename, setFilename] = selectionForm.field("filename");
	return (
		<AttachmentUpload workspaceSlug={workspaceSlug ?? ""} entityType="issue" entityId={issueId}>
			<div className="flex flex-wrap gap-2 items-center max-sm:flex-col max-sm:items-stretch">
				<label className="relative cursor-pointer max-sm:w-full">
					<input
						type="file"
						name="file"
						required
						aria-label="Choose file"
						className="sr-only"
						onChange={(event) => setFilename(event.currentTarget.files?.[0]?.name ?? "")}
					/>
					<Button
						as="span"
						variant="outline"
						size="sm"
						className="max-sm:w-full max-sm:min-h-[44px] truncate block text-center"
					>
						{filename || "Choose file"}
					</Button>
				</label>
				<div className="flex gap-2 max-sm:w-full">
					<Button
						type="submit"
						disabled={!filename}
						variant="primary"
						className="max-sm:flex-1 max-sm:min-h-[44px]"
					>
						Upload
					</Button>
					<Button
						type="button"
						onClick={onCancel}
						variant="outline"
						className="max-sm:flex-1 max-sm:min-h-[44px]"
					>
						Cancel
					</Button>
				</div>
			</div>
		</AttachmentUpload>
	);
}

interface WikiSearchResult {
	id: string;
	slug: string;
	title: string;
	project_id: string | null;
}

function WikiPageLinkForm({
	workspaceSlug,
	linking,
	linkError,
	setLinkError,
	onLink,
	onCancel,
}: {
	workspaceSlug?: string;
	linking: boolean;
	linkError: string | null;
	setLinkError: (e: string | null) => void;
	onLink: (wikiPageId: string) => void;
	onCancel: () => void;
}) {
	const wikiSearchForm = useIssueForm({ query: "" }, Schema.Struct({ query: Text }));
	const [query, setQuery] = wikiSearchForm.field("query");
	const [results, setResults] = useState<WikiSearchResult[]>([]);
	const [searching, setSearching] = useState(false);

	useEffect(() => {
		if (!query.trim()) {
			setResults([]);
			return;
		}
		let cancelled = false;
		setSearching(true);
		const timer = setTimeout(async () => {
			try {
				const data = unwrapResult(
					await Effect.runPromise(
						serverQuery(searchWikiAttachments)({ query: query.trim(), workspaceSlug }),
					),
				);
				if (!cancelled) setResults(Array.isArray(data) ? data : []);
			} catch {
				if (!cancelled) setResults([]);
			} finally {
				if (!cancelled) setSearching(false);
			}
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query, workspaceSlug]);

	return (
		<div className="flex flex-col gap-2 max-w-sm max-sm:max-w-none">
			<input
				type="text"
				value={query}
				onInput={(e) => {
					setQuery((e.target as HTMLInputElement).value);
					setLinkError(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") onCancel();
				}}
				placeholder="Search wiki pages…"
				// biome-ignore lint/a11y/noAutofocus: intentional focus when the inline picker opens
				autoFocus
				disabled={linking}
				className="px-[0.625rem] py-[0.5rem] border border-border rounded text-sm bg-bg text-text-base min-h-[44px]"
			/>
			{searching && <p className="text-xs text-text-muted m-0">Searching…</p>}
			{results.length > 0 && (
				<ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-56 overflow-y-auto">
					{results.map((r) => (
						<li key={r.id}>
							<button
								type="button"
								disabled={linking}
								onClick={() => onLink(r.id)}
								className="w-full text-left px-[0.625rem] py-2 border border-border rounded text-sm
									bg-surface hover:bg-bg transition-colors min-h-[44px]"
							>
								{r.title}
							</button>
						</li>
					))}
				</ul>
			)}
			<div className="flex gap-2">
				<Button
					onClick={onCancel}
					disabled={linking}
					variant="outline"
					size="sm"
					className="max-sm:flex-1 max-sm:min-h-[44px]"
				>
					Cancel
				</Button>
			</div>
			{linkError && (
				<span role="alert" className="text-[0.8rem] text-danger-text">
					{linkError}
				</span>
			)}
		</div>
	);
}

function UrlLinkForm({
	urlValue,
	setUrlValue,
	labelValue,
	setLabelValue,
	linkError,
	setLinkError,
	linking,
	onAdd,
	onCancel,
}: {
	urlValue: string;
	setUrlValue: (v: string) => void;
	labelValue: string;
	setLabelValue: (v: string) => void;
	linkError: string | null;
	setLinkError: (e: string | null) => void;
	linking: boolean;
	onAdd: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="flex flex-wrap gap-2 items-start max-sm:flex-col">
			<input
				type="url"
				value={urlValue}
				onInput={(e) => {
					setUrlValue((e.target as HTMLInputElement).value);
					setLinkError(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") onAdd();
					if (e.key === "Escape") onCancel();
				}}
				placeholder="https://example.com/…"
				// biome-ignore lint/a11y/noAutofocus: intentional focus when the inline editor opens
				autoFocus
				disabled={linking}
				className="px-[0.625rem] py-[0.375rem] border border-border rounded text-sm flex-1 min-w-[10rem]
					max-sm:w-full bg-bg text-text-base min-h-[44px]"
			/>
			<input
				type="text"
				value={labelValue}
				onInput={(e) => setLabelValue((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onAdd();
					if (e.key === "Escape") onCancel();
				}}
				placeholder="Label (optional)"
				disabled={linking}
				className="px-[0.625rem] py-[0.375rem] border border-border rounded text-sm w-40
					max-sm:w-full bg-bg text-text-base min-h-[44px]"
			/>
			<div className="flex gap-2 max-sm:w-full">
				<Button
					onClick={onAdd}
					disabled={linking || !urlValue.trim()}
					variant="primary"
					className="max-sm:flex-1 max-sm:min-h-[44px]"
				>
					{linking ? "Adding…" : "Add"}
				</Button>
				<Button
					onClick={onCancel}
					disabled={linking}
					variant="outline"
					className="max-sm:flex-1 max-sm:min-h-[44px]"
				>
					Cancel
				</Button>
			</div>
			{linkError && (
				<span role="alert" className="text-[0.8rem] text-danger-text self-center">
					{linkError}
				</span>
			)}
		</div>
	);
}

type AttachMode = "none" | "file" | "wiki" | "url";

function useAttachmentLinks(
	issueId: string,
	workspaceSlug: string | undefined,
	onDone: () => void,
) {
	const [linking, setLinking] = useState(false);
	const [linkError, setLinkError] = useState<string | null>(null);
	const urlForm = useIssueForm(
		{ url: "", label: "" },
		Schema.Struct({ url: UrlText, label: Text }),
	);
	const [urlValue, setUrlValue] = urlForm.field("url");
	const [labelValue, setLabelValue] = urlForm.field("label");

	function reset() {
		setLinkError(null);
		setUrlValue("");
		setLabelValue("");
	}

	async function linkWikiPage(wikiPageId: string) {
		setLinking(true);
		setLinkError(null);
		try {
			unwrapResult(
				await addAttachmentLink({ workspaceSlug, issueId, link: { kind: "wiki_ref", wikiPageId } }),
			);
			onDone();
		} catch (e) {
			setLinkError(String(e));
		} finally {
			setLinking(false);
		}
	}

	async function addUrl() {
		if (!(await urlForm.validate())) {
			setLinkError("Enter an http or https URL.");
			return;
		}
		setLinking(true);
		setLinkError(null);
		try {
			unwrapResult(
				await addAttachmentLink({
					workspaceSlug,
					issueId,
					link: { kind: "url", url: urlValue.trim(), label: labelValue.trim() || undefined },
				}),
			);
			onDone();
		} catch (e) {
			setLinkError(String(e));
		} finally {
			setLinking(false);
		}
	}

	return {
		linking,
		linkError,
		setLinkError,
		urlValue,
		setUrlValue,
		labelValue,
		setLabelValue,
		linkWikiPage,
		addUrl,
		reset,
	};
}

function useAttachmentForms(issueId: string, workspaceSlug: string | undefined) {
	const [mode, setMode] = useState<AttachMode>("none");

	function resetForms() {
		setMode("none");
		links.reset();
	}

	const links = useAttachmentLinks(issueId, workspaceSlug, resetForms);

	// PROJ-876: a failed delete is shown, not swallowed.
	const [deleteError, setDeleteError] = useState<string | null>(null);
	async function deleteAttachment(attachmentId: string) {
		setDeleteError(null);
		try {
			unwrapResult(await deleteIssueAttachment({ workspaceSlug, issueId, attachmentId }));
		} catch (e) {
			setDeleteError(`Couldn't delete attachment: ${String(e)}`);
			return;
		}
	}

	return { mode, setMode, links, resetForms, deleteAttachment, deleteError };
}

export function AttachmentsSection({
	issueId,
	workspaceSlug,
	attachments,
}: {
	issueId: string;
	workspaceSlug?: string;
	attachments: Attachment[];
}) {
	const { mode, setMode, links, resetForms, deleteAttachment, deleteError } = useAttachmentForms(
		issueId,
		workspaceSlug,
	);

	return (
		<section className="mb-8">
			<SectionDivider
				title={`Attachments${attachments.length > 0 ? ` (${attachments.length})` : ""}`}
			/>

			{deleteError && (
				<p role="alert" className="mb-2 text-[0.8rem] text-danger-text">
					{deleteError}
				</p>
			)}
			{attachments.length > 0 && (
				<div className="mb-4 flex flex-col gap-2">
					{attachments.map((a) => (
						<AttachmentRow
							key={a.id}
							attachment={a}
							workspaceSlug={workspaceSlug}
							onDelete={() => deleteAttachment(a.id)}
						/>
					))}
				</div>
			)}

			{mode === "file" && (
				<AttachmentUploadForm
					issueId={issueId}
					workspaceSlug={workspaceSlug}
					onCancel={resetForms}
				/>
			)}
			{mode === "wiki" && (
				<WikiPageLinkForm
					workspaceSlug={workspaceSlug}
					linking={links.linking}
					linkError={links.linkError}
					setLinkError={links.setLinkError}
					onLink={links.linkWikiPage}
					onCancel={resetForms}
				/>
			)}
			{mode === "url" && (
				<UrlLinkForm
					urlValue={links.urlValue}
					setUrlValue={links.setUrlValue}
					labelValue={links.labelValue}
					setLabelValue={links.setLabelValue}
					linkError={links.linkError}
					setLinkError={links.setLinkError}
					linking={links.linking}
					onAdd={links.addUrl}
					onCancel={resetForms}
				/>
			)}

			{mode === "none" && (
				<div className="flex flex-wrap gap-x-4 gap-y-2 max-sm:flex-col max-sm:gap-2">
					<button
						type="button"
						onClick={() => setMode("file")}
						className="text-sm text-text-muted hover:text-text-base transition-colors flex items-center gap-1 max-sm:min-h-[44px]"
					>
						<span className="text-base leading-none">+</span>
						<span>Attach file</span>
					</button>
					<button
						type="button"
						onClick={() => setMode("wiki")}
						className="text-sm text-text-muted hover:text-text-base transition-colors flex items-center gap-1 max-sm:min-h-[44px]"
					>
						<span className="text-base leading-none">+</span>
						<span>Link wiki page</span>
					</button>
					<button
						type="button"
						onClick={() => setMode("url")}
						className="text-sm text-text-muted hover:text-text-base transition-colors flex items-center gap-1 max-sm:min-h-[44px]"
					>
						<span className="text-base leading-none">+</span>
						<span>Add URL</span>
					</button>
				</div>
			)}
		</section>
	);
}

function CommentItem({
	comment,
	isEditing,
	editBody,
	editError,
	saving,
	canModify,
	onStartEdit,
	onCancelEdit,
	onChangeBody,
	onSave,
	onDelete,
}: {
	comment: Comment;
	isEditing: boolean;
	editBody: string;
	editError: string | null;
	saving: boolean;
	canModify: boolean;
	onStartEdit: () => void;
	onCancelEdit: () => void;
	onChangeBody: (v: string) => void;
	onSave: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="px-4 py-3 border border-border rounded-lg mb-3 bg-surface shadow-elevation-sm">
			<div className="flex justify-between mb-[0.375rem]">
				<span className="font-semibold text-sm text-text-base">
					{comment.author_name || comment.author_email}
				</span>
				<div className="flex items-center gap-2">
					<span className="text-xs text-text-muted" title={formatDate(comment.created_at)}>
						{relativeTime(comment.created_at)}
					</span>
					{canModify && !isEditing && (
						<>
							<Button onClick={onStartEdit} variant="outline" size="sm">
								Edit
							</Button>
							<Button
								onClick={onDelete}
								size="sm"
								className="bg-transparent border border-danger-text text-danger-text"
							>
								Delete
							</Button>
						</>
					)}
				</div>
			</div>
			{isEditing ? (
				<div>
					{editError && (
						<p role="alert" className="text-danger-text mb-2 text-sm">
							{editError}
						</p>
					)}
					<textarea
						value={editBody}
						onInput={(e) => onChangeBody((e.target as HTMLTextAreaElement).value)}
						rows={4}
						className="w-full px-3 py-2 border border-border rounded text-sm resize-y box-border mb-2 bg-bg text-text-base"
					/>
					<div className="flex gap-2">
						<Button onClick={onSave} disabled={saving} variant="primary">
							{saving ? "Saving…" : "Save"}
						</Button>
						<Button onClick={onCancelEdit} disabled={saving} variant="outline">
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<MarkdownPreview
					content={comment.body}
					initial={comment.renderedBody}
					className="break-words"
				/>
			)}
		</div>
	);
}

function useCommentEditing(issueId: string, workspaceSlug: string | undefined) {
	const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
	const editForm = useIssueForm({ body: "" }, Schema.Struct({ body: CommentText }));
	const [editCommentBody, setEditCommentBody] = editForm.field("body");
	const [savingComment, setSavingComment] = useState(false);
	const [editCommentError, setEditCommentError] = useState<string | null>(null);
	const originalCommentBody = useRef("");
	useUnsavedUnloadGuard(
		editingCommentId !== null && editCommentBody !== originalCommentBody.current,
	);

	function startEditComment(comment: Comment) {
		originalCommentBody.current = comment.body;
		setEditingCommentId(comment.id);
		setEditCommentBody(comment.body);
		setEditCommentError(null);
	}

	function cancelEditComment() {
		setEditingCommentId(null);
		setEditCommentError(null);
	}

	async function saveEditComment(commentId: string) {
		if (!(await editForm.validate())) {
			setEditCommentError("Enter a comment.");
			return;
		}
		setSavingComment(true);
		setEditCommentError(null);
		try {
			unwrapResult(await editComment({ workspaceSlug, issueId, commentId, body: editCommentBody }));
			setEditingCommentId(null);
		} catch (e) {
			setEditCommentError(`Save failed: ${String(e)}`);
		} finally {
			setSavingComment(false);
		}
	}

	async function doDeleteComment(commentId: string) {
		if (!window.confirm("Delete this comment?")) return;
		try {
			unwrapResult(await deleteComment({ workspaceSlug, issueId, commentId }));
		} catch {
			// non-fatal
		}
	}

	return {
		editingCommentId,
		editCommentBody,
		setEditCommentBody,
		savingComment,
		editCommentError,
		startEditComment,
		cancelEditComment,
		saveEditComment,
		doDeleteComment,
	};
}

function useNewCommentForm(
	issueId: string,
	workspaceSlug: string | undefined,
	currentUserId: string | null,
) {
	const commentForm = useIssueForm({ body: "" }, Schema.Struct({ body: CommentText }));
	const [newComment, setNewComment] = commentForm.field("body");
	const [postingComment, setPostingComment] = useState(false);
	const [commentError, setCommentError] = useState<string | null>(null);
	useUnsavedUnloadGuard(newComment.trim().length > 0);
	const key = draftKey(workspaceSlug, `${currentUserId ?? "-"}:${issueId}`, "comment");

	// Restore any unsent comment. Keyed on issueId so switching issues picks up that
	// issue's own draft rather than carrying text across.
	useEffect(() => {
		setNewComment(loadDraft(key) ?? "");
	}, [key, setNewComment]);

	function updateComment(value: string) {
		setNewComment(value);
		saveDraft(key, value);
	}

	async function submitComment(e: import("react").FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!(await commentForm.validate())) {
			setCommentError("Enter a comment.");
			return;
		}
		setPostingComment(true);
		setCommentError(null);
		try {
			unwrapResult(await addComment({ workspaceSlug, issueId, body: newComment.trim() }));
			// Only discard the draft once the server has it — a failed post keeps the text.
			clearDraft(key);
			setNewComment("");
		} catch (e) {
			setCommentError(`Failed to post comment: ${String(e)}`);
		} finally {
			setPostingComment(false);
		}
	}

	return { newComment, setNewComment: updateComment, postingComment, commentError, submitComment };
}

export function CommentsSection({
	issueId,
	workspaceSlug,
	comments,
	currentUserId,
}: {
	issueId: string;
	workspaceSlug?: string;
	comments: Comment[];
	currentUserId: string | null;
}) {
	const {
		editingCommentId,
		editCommentBody,
		setEditCommentBody,
		savingComment,
		editCommentError,
		startEditComment,
		cancelEditComment,
		saveEditComment,
		doDeleteComment,
	} = useCommentEditing(issueId, workspaceSlug);

	const { newComment, setNewComment, postingComment, commentError, submitComment } =
		useNewCommentForm(issueId, workspaceSlug, currentUserId);

	return (
		<section>
			<SectionDivider title={`Comments${comments.length > 0 ? ` (${comments.length})` : ""}`} />

			{comments.length === 0 ? (
				<p className="text-text-muted mb-4">No comments yet.</p>
			) : (
				<div className="mb-6">
					{comments.map((c) => (
						<CommentItem
							key={c.id}
							comment={c}
							isEditing={editingCommentId === c.id}
							editBody={editCommentBody}
							editError={editCommentError}
							saving={savingComment}
							canModify={!!currentUserId && c.author_id === currentUserId}
							onStartEdit={() => startEditComment(c)}
							onCancelEdit={cancelEditComment}
							onChangeBody={setEditCommentBody}
							onSave={() => saveEditComment(c.id)}
							onDelete={() => doDeleteComment(c.id)}
						/>
					))}
				</div>
			)}

			<form onSubmit={submitComment}>
				{commentError && (
					<p role="alert" className="text-danger-text mb-2 text-sm">
						{commentError}
					</p>
				)}
				<textarea
					value={newComment}
					onInput={(e) => setNewComment((e.target as HTMLTextAreaElement).value)}
					placeholder="Add a comment…"
					rows={4}
					// text-base (16px) on phones: below 16px iOS Safari zooms the viewport
					// when the field takes focus. sm:text-sm keeps desktop as it was.
					className={
						"w-full px-3 py-2 border border-border rounded text-base sm:text-sm " +
						"resize-y box-border mb-2 bg-bg text-text-base"
					}
				/>
				<Button
					type="submit"
					disabled={postingComment || !newComment.trim()}
					variant="primary"
					className="max-sm:w-full min-h-[44px]"
				>
					{postingComment ? "Posting…" : "Comment"}
				</Button>
			</form>
		</section>
	);
}

function StatusField({
	issue,
	statuses,
	updatingStatus,
	changeStatus,
}: {
	issue: IssueData;
	statuses: TaskStatus[];
	updatingStatus: boolean;
	changeStatus: (statusId: string) => void;
}) {
	if (statuses.length > 0) {
		return (
			<Select
				ariaLabel="Change status"
				value={issue.status_id ?? ""}
				disabled={updatingStatus}
				onChange={(v) => changeStatus(v)}
				options={statuses.map((s) => ({ value: s.id, label: s.name }))}
				buttonStyle={{ color: categoryColor(issue.status_category), fontWeight: 500 }}
			/>
		);
	}
	if (issue.status_name) {
		return (
			<span className="text-sm font-medium" style={{ color: categoryColor(issue.status_category) }}>
				{issue.status_name}
			</span>
		);
	}
	return <span className="text-sm text-text-muted">—</span>;
}

function TypeField({
	issue,
	taskTypes,
	updatingType,
	typeChangeError,
	changeType,
}: {
	issue: IssueData;
	taskTypes: TaskType[];
	updatingType: boolean;
	typeChangeError: string | null;
	changeType: (typeId: string) => void;
}) {
	if (taskTypes.length > 0) {
		return (
			<>
				<Select
					ariaLabel="Change type"
					value={issue.type_id ?? ""}
					disabled={updatingType}
					onChange={(v) => changeType(v)}
					options={[
						{ value: "", label: "No type" },
						...taskTypes.map((t) => ({ value: t.id, label: t.name })),
					]}
				/>
				{/* PROJ-602: without this, a rejected type change (e.g. demoting an epic
					that still has children) reverts the dropdown with zero explanation. */}
				{typeChangeError && (
					<p role="alert" className="text-danger-text text-xs mt-1">
						{typeChangeError}
					</p>
				)}
			</>
		);
	}
	if (issue.type_name) {
		return <span className="text-sm text-text-base">{issue.type_name}</span>;
	}
	return <span className="text-sm text-text-muted">—</span>;
}

function PointsField({
	issueId,
	workspaceSlug,
	storyPointsValue,
}: {
	issueId: string;
	workspaceSlug?: string;
	storyPointsValue: string;
}) {
	const [editingPoints, setEditingPoints] = useState(false);
	const pointsForm = useIssueForm({ points: "" }, Schema.Struct({ points: PointsText }));
	const [pointsValue, setPointsValue] = pointsForm.field("points");
	const [savingPoints, setSavingPoints] = useState(false);

	function startEditPoints() {
		setPointsValue(storyPointsValue);
		setEditingPoints(true);
	}

	async function savePoints() {
		if (!(await pointsForm.validate())) return;
		const parsed = parseStoryPoints(pointsValue);
		setSavingPoints(true);
		try {
			unwrapResult(
				await updateIssue({
					workspaceSlug,
					issueId,
					patch: { customFields: { story_points: parsed === null ? null : String(parsed) } },
				}),
			);
		} catch {
			// Keep the canonical display on failure. Unsaved editing values are local form state.
		} finally {
			setSavingPoints(false);
			setEditingPoints(false);
		}
	}

	if (editingPoints) {
		return (
			<span className="inline-flex items-center gap-1">
				<input
					type="number"
					value={pointsValue}
					onInput={(e) => setPointsValue((e.target as HTMLInputElement).value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") savePoints();
						if (e.key === "Escape") setEditingPoints(false);
					}}
					onBlur={savePoints}
					disabled={savingPoints}
					// biome-ignore lint/a11y/noAutofocus: intentional focus when the inline editor opens
					autoFocus
					className="w-16 px-[0.375rem] py-[0.125rem] border border-border rounded text-[0.8rem]
						text-center bg-bg text-text-base"
				/>
				<span className="text-xs text-text-muted">pts</span>
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={startEditPoints}
			title="Edit story points"
			className="inline-flex items-center gap-1.5 text-sm text-text-base hover:text-accent
				transition-colors cursor-pointer bg-transparent border-none p-0 text-left"
		>
			<span>{storyPointsValue ? `${storyPointsValue} pts` : "—"}</span>
			<span className="text-text-muted">
				<PencilIcon />
			</span>
		</button>
	);
}

export function SidebarPanel({
	issue,
	issueId,
	workspaceSlug,
	statuses,
	taskTypes,
	members,
	updatingStatus,
	updatingPriority,
	updatingAssignee,
	updatingType,
	typeChangeError,
	changeStatus,
	changePriority,
	changeAssignee,
	changeType,
}: {
	issue: IssueData;
	issueId: string;
	workspaceSlug?: string;
	statuses: TaskStatus[];
	taskTypes: TaskType[];
	members: Member[];
	updatingStatus: boolean;
	updatingPriority: boolean;
	updatingAssignee: boolean;
	updatingType: boolean;
	typeChangeError: string | null;
	changeStatus: (statusId: string) => void;
	changePriority: (priority: string) => void;
	changeAssignee: (assigneeId: string) => void;
	changeType: (typeId: string) => void;
}) {
	const priorityStyle = PRIORITY_COLORS[issue.priority] ?? PRIORITY_COLORS.none;
	const storyPointsField = (issue.customFields ?? []).find((f) => f.key === "story_points");

	return (
		<div className="w-[240px] shrink-0 max-sm:w-full sticky top-4 self-start">
			<div className="rounded-lg border border-border bg-surface px-4 py-2 divide-y divide-border">
				<SidebarField label="Status">
					<StatusField
						issue={issue}
						statuses={statuses}
						updatingStatus={updatingStatus}
						changeStatus={changeStatus}
					/>
				</SidebarField>

				<SidebarField label="Type">
					<TypeField
						issue={issue}
						taskTypes={taskTypes}
						updatingType={updatingType}
						typeChangeError={typeChangeError}
						changeType={changeType}
					/>
				</SidebarField>

				<SidebarField label="Priority">
					<Select
						ariaLabel="Change priority"
						value={issue.priority}
						disabled={updatingPriority}
						capitalize
						onChange={(v) => changePriority(v)}
						options={PRIORITY_OPTIONS}
						buttonStyle={{
							color: priorityStyle.text,
							background: priorityStyle.bg,
							fontWeight: 500,
							borderColor: "transparent",
						}}
					/>
				</SidebarField>

				<SidebarField label="Assignee">
					{members.length > 0 ? (
						<Select
							ariaLabel="Change assignee"
							value={issue.assignee_id ?? ""}
							disabled={updatingAssignee}
							onChange={changeAssignee}
							options={[
								{ value: "", label: "Unassigned" },
								...members.map((m) => ({ value: m.id, label: m.name ?? m.email })),
							]}
						/>
					) : (
						<span className="text-sm text-text-base">{issue.assignee_name ?? "—"}</span>
					)}
				</SidebarField>

				<SidebarField label="Points">
					<PointsField
						issueId={issueId}
						workspaceSlug={workspaceSlug}
						storyPointsValue={storyPointsField?.value ?? ""}
					/>
				</SidebarField>

				{issue.project_name && (
					<SidebarField label="Project">
						<span className="text-sm text-text-base">
							{issue.project_name}
							{issue.project_key && <span className="text-text-muted"> ({issue.project_key})</span>}
						</span>
					</SidebarField>
				)}

				<SidebarField label="Created">
					<span className="text-sm text-text-base">{formatDate(issue.created_at)}</span>
				</SidebarField>

				<SidebarField label="Updated">
					<span className="text-sm text-text-base">{formatDate(issue.updated_at)}</span>
				</SidebarField>
			</div>
		</div>
	);
}
