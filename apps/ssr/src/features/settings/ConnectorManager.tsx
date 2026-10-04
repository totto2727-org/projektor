"use client";

import { useState } from "react";
import { unwrapResult } from "../../client/functions";
import { Button } from "../../components/ui/Button";
import { disconnectConnector } from "./actions";
import type { ConnectorGrant } from "./types";

const TD = "px-3 py-2 border-b border-border align-middle [tr:last-child_&]:border-b-0";
const TD_MUTED = `${TD} font-mono text-[0.8rem] text-text-muted`;
const TH =
	"text-left px-3 py-2 border-b-2 border-border font-semibold text-text-base whitespace-nowrap";
const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleDateString();
export function formatConnectorScopes(scopes: string[]): string {
	if (scopes.some((scope) => scope.endsWith(":write"))) return "Read + Write";
	if (scopes.some((scope) => scope.endsWith(":read"))) return "Read-only";
	return scopes.join(", ") || "–";
}
interface RevokeState {
	id: string | null;
	busy: boolean;
	error: string | null;
	select: (id: string) => void;
	cancel: () => void;
	confirm: (id: string) => void;
}
function RevokeControl({ id, state }: { id: string; state: RevokeState }) {
	if (state.id === id)
		return (
			<span className="inline-flex gap-[0.375rem] items-center flex-wrap">
				<span className="text-[0.8rem] text-text-muted">Disconnect?</span>
				<Button variant="danger" size="sm" disabled={state.busy} onClick={() => state.confirm(id)}>
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
			onClick={() => state.select(id)}
		>
			Disconnect
		</Button>
	);
}
export function ConnectorManager({
	workspaceSlug,
	initialGrants: grants,
}: {
	workspaceSlug: string;
	initialGrants: ConnectorGrant[];
}) {
	const [revokeId, setRevokeId] = useState<string | null>(null);
	const [revoking, setRevoking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function revoke(id: string) {
		if (revoking) return;
		setRevoking(true);
		setError(null);
		try {
			unwrapResult(await disconnectConnector({ workspaceSlug, connectorId: id }));
			setRevokeId(null);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setRevoking(false);
		}
	}
	const state: RevokeState = {
		id: revokeId,
		busy: revoking,
		error,
		select: (id) => {
			setRevokeId(id);
			setError(null);
		},
		cancel: () => setRevokeId(null),
		confirm: revoke,
	};
	if (!grants.length)
		return (
			<div className="p-8 text-center text-text-muted bg-surface rounded-lg border border-border">
				<p className="m-0 mb-2">No connected applications.</p>
				<p className="m-0 text-sm">
					Add this workspace as a connector in Claude to authorize one. It will appear here, and you
					can withdraw it at any time.
				</p>
			</div>
		);
	return (
		<div>
			<p className="m-0 mb-5 text-sm text-text-muted">
				{grants.length} connected application{grants.length !== 1 ? "s" : ""}
			</p>
			<div className="overflow-x-auto max-sm:hidden">
				<table className="w-full border-collapse text-[0.9rem]">
					<thead>
						<tr>
							<th className={TH}>Application</th>
							<th className={TH}>Access</th>
							<th className={TH}>Connected</th>
							<th className={TH}>Expires</th>
							<th className={TH} />
						</tr>
					</thead>
					<tbody>
						{grants.map((grant) => (
							<tr key={grant.id}>
								<td className={`${TD} text-text-base font-medium`}>{grant.client}</td>
								<td className={TD_MUTED}>{formatConnectorScopes(grant.scopes)}</td>
								<td className={TD_MUTED}>{date(grant.grantedAt)}</td>
								<td className={TD_MUTED}>{date(grant.expiresAt)}</td>
								<td className={`${TD} whitespace-nowrap`}>
									<RevokeControl id={grant.id} state={state} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="hidden max-sm:flex max-sm:flex-col max-sm:gap-3">
				{grants.map((grant) => (
					<div key={grant.id} className="py-3 px-4 border border-border rounded-md bg-surface">
						<div className="text-[0.9rem] text-text-base font-medium mb-2">{grant.client}</div>
						<dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[0.8rem] text-text-muted mb-3">
							<dt className="font-semibold">Access</dt>
							<dd className="m-0">{formatConnectorScopes(grant.scopes)}</dd>
							<dt className="font-semibold">Connected</dt>
							<dd className="m-0">{date(grant.grantedAt)}</dd>
							<dt className="font-semibold">Expires</dt>
							<dd className="m-0">{date(grant.expiresAt)}</dd>
						</dl>
						<RevokeControl id={grant.id} state={state} />
					</div>
				))}
			</div>
		</div>
	);
}
