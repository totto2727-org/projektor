"use client";

import { useEffect, useRef } from "react";
import { renderMd, renderMermaidDiagrams } from "./render-markdown";

export { default as LazyMarkdownEditor } from "./LazyMarkdownEditor";
export type { Props as MarkdownEditorProps } from "./MarkdownEditor";
export { default as MarkdownEditor } from "./MarkdownEditor";
export {
	renderMarkdown,
	renderMd,
	renderMdWithWikilinks,
	renderMermaidDiagrams,
	stripFrontmatter,
} from "./render-markdown";

/** The original sanitized markdown tree, present in server HTML before hydration. */
export function MarkdownViewer({
	content,
	className = "",
}: {
	readonly content: string;
	readonly className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const html = renderMd(content);
	useEffect(() => {
		if (html && ref.current) void renderMermaidDiagrams(ref.current).catch(() => undefined);
	}, [html]);
	return (
		<div
			ref={ref}
			className={`prose prose-sm max-w-none ${className}`}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: renderMd always uses server-safe sanitize-html.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
