import { String, Predicate } from 'effect'
import sanitizeHtml from 'sanitize-html'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

export interface Heading {
  level: number
  text: string
  id: string
}

const MAX_UNICODE_CODE_POINT = 0x10_ff_ff
const DECIMAL_RADIX = 10
const HEXADECIMAL_RADIX = 16
const HEADING_ID = /\bid="(?<id>[^"]*)"/u

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
      .replaceAll(/[^a-z0-9]+/gu, '-')
      .replaceAll(/^-|-$/gu, '')
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
    .replaceAll(/&#(?<entity>x[0-9a-f]+|\d+);/giu, (_match, entity: string) =>
      globalThis.String.fromCodePoint(
        Math.min(
          MAX_UNICODE_CODE_POINT,
          entity[0].toLowerCase() === 'x'
            ? Number.parseInt(entity.slice(1), HEXADECIMAL_RADIX)
            : Number.parseInt(entity, DECIMAL_RADIX),
        ),
      ),
    )
    .replaceAll('&quot;', '"')
    .replaceAll(/&apos;|&#39;/gu, "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/** Add the same stable IDs before SSR so hash links and ToC work without JavaScript. */
export const decorateHeadings = function decorateHeadings(html: string): { html: string; toc: Heading[] } {
  const matches = [...html.matchAll(/<h(?<level>[1-3])(?<attributes>[^>]*)>(?<content>[\s\S]*?)<\/h[1-3]>/gu)]
  const headings = matches.map((match) => {
    const { level, attributes, content } = match.groups ?? {}
    const authored = HEADING_ID.exec(attributes)?.groups?.id
    return {
      level: Number(level),
      text: textOf(content),
      id: isNonEmptyText(authored) ? textOf(authored) : undefined,
    }
  })
  const ids = assignHeadingIds(headings)
  const toc = headings.map((heading, index) => ({ ...heading, id: ids[index] }))
  let index = 0
  const decorated = html.replaceAll(
    /<h(?<level>[1-3])(?<attributes>[^>]*)>/gu,
    (_match, level: string, attributes: string) => {
      const id = ids[index++]
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
      return `<h${level}${attributes.replaceAll(/\s+id="[^"]*"/gu, '')} id="${id}">`
    },
  )
  return { html: decorated, toc }
}
