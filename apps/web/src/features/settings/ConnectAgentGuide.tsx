"use client";

import { useState } from "react";
import { Button } from "../../components/ui/Button";

const URL_CODE =
	"flex-1 font-mono text-[0.8rem] px-2 py-[0.375rem] bg-bg border border-border rounded text-text-base break-all";
export function ConnectAgentGuide({
	workspaceSlug,
	mcpUrl,
}: {
	workspaceSlug: string;
	mcpUrl: string | null;
}) {
	const [message, setMessage] = useState<string | null>(null);
	async function copy() {
		if (!mcpUrl) return;
		try {
			await navigator.clipboard.writeText(mcpUrl);
			setMessage("Copied to clipboard.");
		} catch {
			setMessage("Clipboard unavailable. Select and copy the URL manually.");
		}
	}
	return (
		<div className="mb-6 px-5 py-4 bg-surface border border-border rounded-lg">
			<h3 className="m-0 mb-3 text-base font-semibold text-text-base">Connect Claude Code</h3>
			<ol className="m-0 mb-3 pl-5 text-sm text-text-base [&>li]:mb-1.5">
				<li>In Claude, go to Settings → Connectors and click "Add custom connector."</li>
				<li>
					Paste this server URL{mcpUrl ? "" : " (unavailable)"}, leave request headers empty, and
					click Add.
				</li>
				<li>Sign in when prompted, then approve the consent screen.</li>
			</ol>
			{mcpUrl ? (
				<div className="flex items-center gap-2">
					<code className={URL_CODE}>{mcpUrl}</code>
					<Button variant="outline" size="sm" onClick={copy}>
						Copy
					</Button>
				</div>
			) : (
				<p role="status" className="text-sm text-text-muted">
					MCP URL unavailable for {workspaceSlug}.
				</p>
			)}
			{message && (
				<p role="status" className="text-xs text-text-muted">
					{message}
				</p>
			)}
			<p className="m-0 mt-3 text-xs text-text-muted">
				What you can see and do is automatically scoped to your workspace role and group access. No
				token or admin step needed.
			</p>
		</div>
	);
}
