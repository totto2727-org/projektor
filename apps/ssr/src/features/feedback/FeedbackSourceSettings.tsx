"use client";

import { useState } from "react";
import { unwrapResult } from "../../client/functions";
import { Button } from "../../components/ui/Button";
import {
	revokeFeedbackSource,
	rotateFeedbackSourceToken,
	setFeedbackSourceActive,
} from "./actions";

export interface FeedbackSource {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	allowedOrigins: string[] | null;
	tokenPreview: string;
	createdAt: number;
	revokedAt: number | null;
}

export interface FeedbackVersionSummary {
	appVersion: string | null;
	totalCount: number;
	withCommentCount: number;
	thumbsUpPct: number | null;
	avgFiveStar: number | null;
	lastSeenAt: number;
}

interface Props {
	source: FeedbackSource;
	projectId: string;
	workspaceSlug?: string;
	onChanged?: () => void;
}

function formatDate(ts: number): string {
	return new Date(ts * 1000).toLocaleDateString();
}

function NewTokenReveal({ token, onDismiss }: { token: string; onDismiss: () => void }) {
	return (
		<div className="bg-surface border border-border rounded-md p-4">
			<p className="text-danger-text text-[0.8rem] my-1">
				⚠ Copy this token now — you won't be able to see it again.
			</p>
			<code className="block font-mono text-[0.8rem] px-2 py-[0.375rem] bg-bg border border-border rounded break-all">
				{token}
			</code>
			<Button variant="outline" size="sm" className="mt-2" onClick={onDismiss}>
				Done
			</Button>
		</div>
	);
}

function DangerZone({
	rotating,
	onRotateStart,
	onRotateCancel,
	onRotateConfirm,
	onRevoke,
}: {
	rotating: boolean;
	onRotateStart: () => void;
	onRotateCancel: () => void;
	onRotateConfirm: () => void;
	onRevoke: () => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[0.8rem] font-semibold text-text-muted">Danger zone</span>
			{rotating ? (
				<span className="inline-flex gap-[0.375rem] items-center flex-wrap">
					<span className="text-[0.8rem] text-text-muted">Rotate? Old token dies.</span>
					<Button variant="danger" size="sm" onClick={onRotateConfirm}>
						Yes
					</Button>
					<Button variant="outline" size="sm" onClick={onRotateCancel}>
						No
					</Button>
				</span>
			) : (
				<span className="inline-flex gap-[0.375rem]">
					<Button variant="outline" size="sm" onClick={onRotateStart}>
						Rotate token
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="text-danger-text border-danger-border"
						onClick={onRevoke}
					>
						Revoke source
					</Button>
				</span>
			)}
		</div>
	);
}

export default function FeedbackSourceSettings({
	source,
	projectId,
	workspaceSlug,
	onChanged,
}: Props) {
	const [rotating, setRotating] = useState(false);
	const [newToken, setNewToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function toggleActive() {
		try {
			unwrapResult(
				await setFeedbackSourceActive({
					workspaceSlug,
					projectId,
					sourceId: source.id,
					active: !source.isActive,
				})
			);
			onChanged?.();
		} catch (e) {
			setError(String(e));
		}
	}

	async function confirmRotate() {
		try {
			const result = unwrapResult(
				await rotateFeedbackSourceToken({ workspaceSlug, projectId, sourceId: source.id })
			);
			setRotating(false);
			setNewToken(result.token);
			onChanged?.();
		} catch (e) {
			setError(String(e));
		}
	}

	async function revoke() {
		if (!window.confirm(`Revoke ${source.name}? Its token will stop accepting feedback.`)) return;
		try {
			unwrapResult(await revokeFeedbackSource({ workspaceSlug, projectId, sourceId: source.id }));
			onChanged?.();
		} catch (e) {
			setError(String(e));
		}
	}

	return (
		<section className="flex flex-col gap-4 max-w-[520px]">
			{error && (
				<p role="alert" className="text-danger-text">
					{error}
				</p>
			)}

			{newToken && <NewTokenReveal token={newToken} onDismiss={() => setNewToken(null)} />}

			<div className="flex flex-col gap-1">
				<span className="text-[0.8rem] font-semibold text-text-muted">Token</span>
				<code className="font-mono text-[0.85rem]">{source.tokenPreview}</code>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[0.8rem] font-semibold text-text-muted">Status</span>
				<Button variant="outline" size="sm" className="w-fit" onClick={toggleActive}>
					{source.isActive ? "Active" : "Inactive"}
				</Button>
			</div>

			<div className="flex flex-col gap-1">
				<span className="text-[0.8rem] font-semibold text-text-muted">Created</span>
				<span className="text-[0.875rem] text-text-base">{formatDate(source.createdAt)}</span>
			</div>

			<DangerZone
				rotating={rotating}
				onRotateStart={() => setRotating(true)}
				onRotateCancel={() => setRotating(false)}
				onRotateConfirm={confirmRotate}
				onRevoke={revoke}
			/>
		</section>
	);
}
