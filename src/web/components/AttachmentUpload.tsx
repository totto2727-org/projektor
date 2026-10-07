"use client";

import { type FormEventHandler, type ReactNode, useActionState } from "react";
import { uploadAttachment } from "../attachment-actions";

export interface AttachmentUploadProps {
	workspaceSlug: string;
	entityType: "issue" | "wiki_page";
	entityId: string;
	className?: string;
	children?: ReactNode;
	onSubmit?: FormEventHandler<HTMLFormElement>;
}

/** Effront form action owns upload decoding, request limits and canonical SSR refresh. */
export function AttachmentUpload({
	workspaceSlug,
	entityType,
	entityId,
	className,
	children,
	onSubmit,
}: AttachmentUploadProps) {
	const [result, formAction, pending] = useActionState(uploadAttachment, null);
	return (
		<form action={formAction} className={className} onSubmit={onSubmit}>
			<input type="hidden" name="workspaceSlug" value={workspaceSlug} />
			<input type="hidden" name="entityType" value={entityType} />
			<input type="hidden" name="entityId" value={entityId} />
			<fieldset disabled={pending} className="border-0 p-0 m-0 min-w-0">
				{children ?? (
					<>
						<label className="btn btn-secondary cursor-pointer">
							<span>Choose file</span>
							<input type="file" name="file" required className="sr-only" />
						</label>
						<button type="submit" className="btn btn-primary ml-2">
							Upload
						</button>
					</>
				)}
			</fieldset>
			<p className="text-xs text-text-muted">
				Uploads are subject to Effront’s request-body limit, currently 10 MiB including form data.
			</p>
			{pending && <p role="status">Uploading…</p>}
			{result && !result.ok && (
				<p role="alert" className="text-danger-text">
					{result.message}
				</p>
			)}
		</form>
	);
}
