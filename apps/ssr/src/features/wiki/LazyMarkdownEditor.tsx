"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import type { Props } from "./MarkdownEditor";

// PROJ-431: MarkdownEditor pulls in CodeMirror — 486 KiB raw / 168 KiB gzip, 76% of
// the JS on /issues/view and /wiki. As a static import every *reader* of an issue paid
// for it, though it only renders after tapping Edit. Loading it on demand takes those
// pages from 221 KiB to ~53 KiB gzip.
//
// A plain dynamic import keeps the original usable textarea mounted while the
// CodeMirror chunk loads. Reader routes do not pay the editor's JavaScript cost.

// Shown while the chunk is in flight. Deliberately a working textarea rather than a
// spinner: on a slow mobile connection the chunk can take seconds, and the whole point
// of tapping Edit is to type. Same controlled contract as the real editor, so whatever
// is typed here is already in `value` when CodeMirror mounts and adopts it.
function EditorFallback({ value, onChange, minHeight, ariaLabel = "Markdown editor" }: Props) {
	return (
		<div className="flex flex-col border border-border rounded overflow-hidden bg-bg normal-case font-normal">
			<div
				className={
					"px-2 py-[2px] text-[0.7rem] text-text-muted bg-surface border-b border-border " +
					"shrink-0 uppercase tracking-[0.06em]"
				}
			>
				Loading editor…
			</div>
			<textarea
				value={value}
				onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
				aria-label={ariaLabel}
				style={{ minHeight }}
				className="w-full px-3 py-2 border-0 resize-y box-border bg-bg text-text-base font-mono
					text-base sm:text-sm leading-[1.6] focus:outline-hidden"
			/>
		</div>
	);
}

export default function LazyMarkdownEditor(props: Props) {
	const [Editor, setEditor] = useState<ComponentType<Props> | null>(null);

	useEffect(() => {
		let cancelled = false;
		import("./MarkdownEditor")
			.then((m) => {
				// Wrapped in a thunk: a bare component would be read as a state updater.
				if (!cancelled) setEditor(() => m.default);
			})
			.catch((err) => {
				// PROJ-506: an unhandled rejection here (chunk-load failure on a flaky
				// connection in prod, or the import resolving after a test's jsdom
				// environment has already torn down) otherwise surfaces as an uncaught
				// error with no indication of what failed. The user already has a
				// working fallback textarea regardless, so there's nothing to recover.
				if (!cancelled) console.error("Failed to load the markdown editor", err);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return Editor ? <Editor {...props} /> : <EditorFallback {...props} />;
}
