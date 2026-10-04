"use client";

import { useForm } from "@tanstack/react-form";
import { Schema } from "effect";
import { useActionState, useEffect, useRef, useState } from "react";
import { unwrapResult } from "../../client/functions";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeaderCell,
	TableRow,
} from "../../components/ui/Table";
import { FormErrors } from "../planning/form-ui";
import { createToken, revokeToken } from "./actions";
import { CreateTokenInputSchema } from "./input-schemas";
import type { NewTokenResult, Token } from "./types";

const TOKEN_CODE =
	"flex-1 font-mono text-[0.8rem] px-2 py-[0.375rem] bg-bg border border-border rounded text-text-base break-all";
const MCP_COMMAND =
	"font-mono text-xs px-3 py-2 bg-bg border border-border rounded text-text-muted break-all whitespace-pre-wrap leading-[1.6]";
export function formatTokenScopes(raw: string): string {
	let scopes: unknown;
	try {
		scopes = JSON.parse(raw);
	} catch {
		return "–";
	}
	if (!Array.isArray(scopes)) return "–";
	if (scopes.includes("*")) return "Full access (*)";
	if (scopes.includes("write")) return "Read + Write";
	if (scopes.includes("read")) return "Read-only";
	return scopes.filter((value): value is string => typeof value === "string").join(", ") || "–";
}
function formatDate(timestamp: number | null): string {
	return timestamp === null ? "Never" : new Date(timestamp * 1000).toLocaleDateString();
}
function NewTokenPanel({
	token,
	template,
	onDone,
}: {
	token: NewTokenResult;
	template: string | null;
	onDone: () => void;
}) {
	const command = template?.replace("{{TOKEN}}", token.token) ?? "";
	const [copyMessage, setCopyMessage] = useState<string | null>(null);
	async function copy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			setCopyMessage("Copied to clipboard.");
		} catch {
			setCopyMessage("Clipboard unavailable. Select and copy the text manually.");
		}
	}
	return (
		<div className="bg-surface border border-border rounded-md p-4 mt-4">
			<p className="m-0 mb-2 font-semibold text-[0.9rem] text-text-base">
				Token created: <span className="font-mono text-[0.8rem] text-text-muted">{token.name}</span>
			</p>
			<p className="text-danger-text text-[0.8rem] my-1">
				⚠ Copy this token now. You won't be able to see it again.
			</p>
			<div className="flex items-center gap-2 my-2">
				<code className={TOKEN_CODE}>{token.token}</code>
				<Button variant="outline" size="sm" onClick={() => copy(token.token)}>
					Copy
				</Button>
			</div>
			{template && (
				<div className="mt-4">
					<p className="m-0 mb-[0.375rem] text-[0.8rem] font-semibold text-text-muted">
						Connect to Claude:
					</p>
					<div className={MCP_COMMAND}>{command}</div>
					<Button variant="outline" size="sm" className="mt-2" onClick={() => copy(command)}>
						Copy command
					</Button>
					<p className="m-0 mt-[0.375rem] text-xs text-text-muted">
						Run this command in your terminal to connect Claude Code to this workspace.
					</p>
				</div>
			)}
			{copyMessage && (
				<p role="status" className="text-xs text-text-muted">
					{copyMessage}
				</p>
			)}
			<div className="mt-4">
				<Button variant="outline" size="sm" onClick={onDone}>
					Done
				</Button>
			</div>
		</div>
	);
}
interface RevokeState {
	id: string | null;
	busy: boolean;
	error: string | null;
	select: (id: string) => void;
	cancel: () => void;
	confirm: (id: string) => void;
}
function TokenRevokeControl({ token, state }: { token: Token; state: RevokeState }) {
	if (state.id === token.id)
		return (
			<span className="inline-flex gap-[0.375rem] items-center flex-wrap">
				<span className="text-[0.8rem] text-text-muted">Revoke?</span>
				<Button
					variant="danger"
					size="sm"
					disabled={state.busy}
					onClick={() => state.confirm(token.id)}
				>
					{state.busy ? "…" : "Yes"}
				</Button>
				<Button variant="outline" size="sm" disabled={state.busy} onClick={state.cancel}>
					No
				</Button>
				{state.error && (
					<span role="alert" className="text-danger-text text-xs">
						{state.error}
					</span>
				)}
			</span>
		);
	return (
		<Button
			variant="outline"
			size="sm"
			className="text-danger-text border-danger-border"
			disabled={state.busy}
			onClick={() => state.select(token.id)}
		>
			Revoke
		</Button>
	);
}
function TokenTable({ tokens, state }: { tokens: Token[]; state: RevokeState }) {
	if (!tokens.length)
		return (
			<EmptyState
				className="bg-surface rounded-lg border border-border"
				title="No API tokens yet."
				description="Create a token to allow agents and scripts to authenticate."
			/>
		);
	return (
		<>
			<div className="overflow-x-auto max-sm:hidden">
				<Table>
					<TableHead>
						<TableRow>
							<TableHeaderCell>Name</TableHeaderCell>
							<TableHeaderCell>Scope</TableHeaderCell>
							<TableHeaderCell>Created</TableHeaderCell>
							<TableHeaderCell>Expires</TableHeaderCell>
							<TableHeaderCell>Last used</TableHeaderCell>
							<TableHeaderCell />
						</TableRow>
					</TableHead>
					<TableBody>
						{tokens.map((token) => (
							<TableRow key={token.id}>
								<TableCell className="text-text-base font-medium">{token.name}</TableCell>
								<TableCell muted>{formatTokenScopes(token.scopes)}</TableCell>
								<TableCell muted>{formatDate(token.createdAt)}</TableCell>
								<TableCell
									className={`font-mono text-[0.8rem] ${token.expiresAt !== null && token.expiresAt < Date.now() / 1000 ? "text-danger-text" : "text-text-muted"}`}
								>
									{token.expiresAt === null ? "No expiry" : formatDate(token.expiresAt)}
								</TableCell>
								<TableCell muted>{formatDate(token.lastUsedAt)}</TableCell>
								<TableCell className="whitespace-nowrap">
									<TokenRevokeControl token={token} state={state} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
				{tokens.map((token) => (
					<div key={token.id} className="py-3 px-4 border border-border rounded-md bg-surface">
						<div className="text-[0.9rem] text-text-base font-medium mb-2">{token.name}</div>
						<dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.8rem] text-text-muted mb-3">
							<dt className="font-semibold">Scope</dt>
							<dd className="m-0">{formatTokenScopes(token.scopes)}</dd>
							<dt className="font-semibold">Created</dt>
							<dd className="m-0">{formatDate(token.createdAt)}</dd>
							<dt className="font-semibold">Expires</dt>
							<dd
								className={`m-0 ${token.expiresAt !== null && token.expiresAt < Date.now() / 1000 ? "text-danger-text" : ""}`}
							>
								{token.expiresAt === null ? "No expiry" : formatDate(token.expiresAt)}
							</dd>
							<dt className="font-semibold">Last used</dt>
							<dd className="m-0">{formatDate(token.lastUsedAt)}</dd>
						</dl>
						<TokenRevokeControl token={token} state={state} />
					</div>
				))}
			</div>
		</>
	);
}
/** The one-time secret is client-only mutation state. The token list always comes from SSR. */
export function TokenManager({
	workspaceSlug,
	initialTokens: tokens,
	mcpCommandTemplate = null,
}: {
	workspaceSlug: string;
	initialTokens: Token[];
	mcpUrl: string | null;
	mcpCommandTemplate?: string | null;
}) {
	const [showCreate, setShowCreate] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [newToken, setNewToken] = useState<NewTokenResult | null>(null);
	const [revokeId, setRevokeId] = useState<string | null>(null);
	const [revoking, setRevoking] = useState(false);
	const [revokeError, setRevokeError] = useState<string | null>(null);
	const [createResult, createAction, creating] = useActionState(createToken, null);
	useEffect(() => {
		if (!createResult) return;
		if (createResult.ok) {
			setNewToken(createResult.value);
			setError(null);
		} else setError(createResult.message);
	}, [createResult]);
	const inputRef = useRef<HTMLInputElement>(null);
	const defaults = useRef({
		workspaceSlug,
		name: "",
		scope: "readwrite" as "read" | "readwrite",
		expiry: "",
	}).current;
	const standard = Schema.toStandardSchemaV1(CreateTokenInputSchema);
	const form = useForm({
		defaultValues: defaults,
		validators: { onMount: standard, onChange: standard, onSubmit: standard },
	});
	function open() {
		setShowCreate(true);
		form.reset();
		setError(null);
		setNewToken(null);
		setTimeout(() => inputRef.current?.focus(), 0);
	}
	function close() {
		setShowCreate(false);
		setNewToken(null);
		setError(null);
	}
	async function revoke(id: string) {
		if (revoking) return;
		setRevoking(true);
		setRevokeError(null);
		try {
			unwrapResult(await revokeToken({ workspaceSlug, tokenId: id }));
			setRevokeId(null);
		} catch (cause) {
			setRevokeError(String(cause));
		} finally {
			setRevoking(false);
		}
	}
	const state: RevokeState = {
		id: revokeId,
		busy: revoking,
		error: revokeError,
		select: (id) => {
			setRevokeId(id);
			setRevokeError(null);
		},
		cancel: () => setRevokeId(null),
		confirm: revoke,
	};
	return (
		<div>
			<div className="flex justify-between items-center mb-5">
				<p className="m-0 text-sm text-text-muted">
					{tokens.length} token{tokens.length !== 1 ? "s" : ""}
				</p>
				{!showCreate && (
					<Button variant="primary" size="sm" onClick={open}>
						+ New token
					</Button>
				)}
			</div>
			{showCreate && (
				<div className="mb-6 px-5 py-4 bg-surface border border-border rounded-lg">
					{newToken ? (
						<NewTokenPanel token={newToken} template={mcpCommandTemplate} onDone={close} />
					) : (
						<form action={createAction}>
							<input type="hidden" name="workspaceSlug" value={workspaceSlug} />
							<form.Subscribe
								selector={(state) => ({
									canSubmit: state.canSubmit,
									errors: state.errors,
									dirty: state.isDirty,
								})}
							>
								{({ canSubmit, errors, dirty }) => (
									<>
										<h3 className="m-0 mb-4 text-base font-semibold text-text-base">
											New API token
										</h3>
										<div className="flex flex-col gap-1 mb-[0.875rem]">
											<label
												className="text-[0.8rem] font-semibold text-text-muted"
												htmlFor="tok-name"
											>
												Name *
											</label>
											<form.Field name="name">
												{(field) => (
													<Input
														inputRef={inputRef}
														id="tok-name"
														name="name"
														type="text"
														placeholder="e.g. Claude Code agent"
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(event) => field.handleChange(event.currentTarget.value)}
														disabled={creating}
														required
														maxLength={100}
													/>
												)}
											</form.Field>
										</div>
										<div className="flex flex-col gap-1 mb-[0.875rem]">
											<span className="text-[0.8rem] font-semibold text-text-muted">Scope</span>
											<div className="flex flex-col gap-[0.375rem]">
												<form.Field name="scope">
													{(field) => (
														<>
															<label className="flex items-center gap-2 cursor-pointer text-sm text-text-base">
																<input
																	type="radio"
																	name="scope"
																	value="readwrite"
																	checked={field.state.value === "readwrite"}
																	disabled={creating}
																	onBlur={field.handleBlur}
																	onChange={() => field.handleChange("readwrite")}
																/>
																Read + Write (recommended)
															</label>
															<label className="flex items-center gap-2 cursor-pointer text-sm text-text-base">
																<input
																	type="radio"
																	name="scope"
																	value="read"
																	checked={field.state.value === "read"}
																	disabled={creating}
																	onBlur={field.handleBlur}
																	onChange={() => field.handleChange("read")}
																/>
																Read-only
															</label>
														</>
													)}
												</form.Field>
											</div>
										</div>
										<div className="flex flex-col gap-1 mb-[0.875rem]">
											<label
												className="text-[0.8rem] font-semibold text-text-muted"
												htmlFor="tok-expiry"
											>
												Expires in (days, optional)
											</label>
											<form.Field name="expiry">
												{(field) => (
													<Input
														id="tok-expiry"
														name="expiry"
														className="sm:max-w-[240px]"
														type="number"
														min={1}
														max={365}
														placeholder="e.g. 90 (leave blank for no expiry)"
														value={field.state.value}
														disabled={creating}
														onBlur={field.handleBlur}
														onChange={(event) => field.handleChange(event.currentTarget.value)}
													/>
												)}
											</form.Field>
										</div>
										{error && (
											<p role="alert" className="text-danger-text text-[0.8rem] m-0 mb-3">
												{error}
											</p>
										)}
										<div className="flex gap-2">
											{dirty && <FormErrors errors={errors} />}
											<Button
												type="submit"
												variant="primary"
												size="sm"
												disabled={creating || !canSubmit}
											>
												{creating ? "Creating…" : "Create token"}
											</Button>
											<Button variant="outline" size="sm" disabled={creating} onClick={close}>
												Cancel
											</Button>
										</div>
									</>
								)}
							</form.Subscribe>
						</form>
					)}
				</div>
			)}
			<TokenTable tokens={tokens} state={state} />
		</div>
	);
}
