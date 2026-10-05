import sanitizeHtml from "sanitize-html";

export interface Heading {
	level: number;
	text: string;
	id: string;
}

/** Original Wiki heading-id allocation, including authored-id reservation. */
export function assignHeadingIds(
	headings: ReadonlyArray<{ text: string; id?: string | null }>,
): string[] {
	const used = new Set<string>();
	const result: (string | null)[] = headings.map((heading) => {
		const authored = heading.id?.trim();
		if (!authored || used.has(authored)) return null;
		used.add(authored);
		return authored;
	});
	return headings.map((heading, index) => {
		const kept = result[index];
		if (kept !== null) return kept;
		const slug = heading.text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
		const base = heading.id?.trim() || slug || `section-${index + 1}`;
		let candidate = base;
		for (let n = 1; used.has(candidate); n++) candidate = `${base}-${n}`;
		used.add(candidate);
		return candidate;
	});
}
function textOf(html: string): string {
	return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
		.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, entity: string) =>
			String.fromCodePoint(
				Math.min(
					0x10ffff,
					entity[0].toLowerCase() === "x" ? parseInt(entity.slice(1), 16) : parseInt(entity, 10),
				),
			),
		)
		.replace(/&quot;/g, '"')
		.replace(/&apos;|&#39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

/** Add the same stable IDs before SSR so hash links and ToC work without JavaScript. */
export function decorateHeadings(html: string): { html: string; toc: Heading[] } {
	const matches = [...html.matchAll(/<h([1-3])([^>]*)>([\s\S]*?)<\/h[1-3]>/g)];
	const headings = matches.map((match) => ({
		level: Number(match[1]),
		text: textOf(match[3]),
		id: /\bid="([^"]*)"/.exec(match[2])?.[1]
			? textOf(/\bid="([^"]*)"/.exec(match[2])?.[1] ?? "")
			: undefined,
	}));
	const ids = assignHeadingIds(headings);
	const toc = headings.map((heading, index) => ({ ...heading, id: ids[index] }));
	let index = 0;
	const decorated = html.replace(/<h([1-3])([^>]*)>/g, (_, level: string, attributes: string) => {
		const id = ids[index++]
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;");
		return `<h${level}${attributes.replace(/\s+id="[^"]*"/g, "")} id="${id}">`;
	});
	return { html: decorated, toc };
}
