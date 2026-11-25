import { String, Predicate } from 'effect'
import sanitizeHtml from 'sanitize-html'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

export interface Heading {
  level: number
  text: string
  id: string
}

/** Original Wiki heading-id allocation, including authored-id reservation. */
export const assignHeadingIds = function assignHeadingIds(
  headings: Readonly<{ text: string; id?: string | null }[]>,
): string[] {
  const used = new Set<string>()
  const result: (string | null)[] = headings.map((heading) => {
    const authored = heading.id?.trim()
    if (Predicate.isNullish(authored) || String.isEmpty(authored) || used.has(authored)) {
      return null
    }
    used.add(authored)
    return authored
  })
  return headings.map((heading, index) => {
    const kept = result[index]
    if (Predicate.isNotNullish(kept)) {
      return kept
    }
    const slug = heading.text
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '')
    const base = heading.id?.trim() || slug || `section-${index + 1}`
    let candidate = base
    for (let n = 1; used.has(candidate); n++) {
      candidate = `${base}-${n}`
    }
    used.add(candidate)
    return candidate
  })
}
const textOf = function textOf(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replaceAll(/&#(x[0-9a-f]+|\d+);/gi, (_match, entity: string) =>
      globalThis.String.fromCodePoint(
        Math.min(0x10_ff_ff, entity[0].toLowerCase() === 'x' ? parseInt(entity.slice(1), 16) : parseInt(entity, 10)),
      ),
    )
    .replaceAll('&quot;', '"')
    .replaceAll(/&apos;|&#39;/g, "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/** Add the same stable IDs before SSR so hash links and ToC work without JavaScript. */
export const decorateHeadings = function decorateHeadings(html: string): { html: string; toc: Heading[] } {
  const matches = [...html.matchAll(/<h([1-3])([^>]*)>([\s\S]*?)<\/h[1-3]>/g)]
  const headings = matches.map((match) => ({
    level: Number(match[1]),
    text: textOf(match[3]),
    id: isNonEmptyText(/\bid="([^"]*)"/.exec(match[2])?.[1])
      ? textOf(/\bid="([^"]*)"/.exec(match[2])?.[1] ?? '')
      : undefined,
  }))
  const ids = assignHeadingIds(headings)
  const toc = headings.map((heading, index) => ({ ...heading, id: ids[index] }))
  let index = 0
  const decorated = html.replaceAll(/<h([1-3])([^>]*)>/g, (_match, level: string, attributes: string) => {
    const id = ids[index++]
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
    return `<h${level}${attributes.replaceAll(/\s+id="[^"]*"/g, '')} id="${id}">`
  })
  return { html: decorated, toc }
}
