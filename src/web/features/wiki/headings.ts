import { Iterable, MutableRef, Number, Option, Predicate } from 'effect'
import sanitizeHtml from 'sanitize-html'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

export interface Heading {
  level: number
  text: string
  id: string
}

const MAX_UNICODE_CODE_POINT = 1_114_111
const DECIMAL_RADIX = 10
const HEXADECIMAL_RADIX = 16
const HEX_ENTITY_PREFIX = 'x'
const FIRST_HEADING_INDEX = 0
const HEADING_ID = /\bid="(?<id>[^"]*)"/u

const availableHeadingId = function availableHeadingId(base: string, used: ReadonlySet<string>): string {
  const suffixes = Iterable.makeBy((index) => `${base}-${Number.increment(index)}`, {
    length: used.size,
  })
  const candidates = Iterable.prepend(suffixes, base)
  return Option.getOrThrow(Iterable.findFirst(candidates, (candidate) => !used.has(candidate)))
}

/**
 * Allocate stable Wiki heading IDs and reserve author-provided IDs before assigning automatic ones.
 *
 * @param {Readonly<{text: string, id?: string | null}[]>} headings The headings in document order.
 * @returns {string[]} The corresponding unique IDs, including disambiguation suffixes where needed.
 */
export const assignHeadingIds = function assignHeadingIds(
  headings: Readonly<{ text: string; id?: string | null }[]>,
): string[] {
  const used = new Set<string>()
  const reserve = (candidate: string): string => {
    used.add(candidate)
    return candidate
  }
  const result = headings.map((heading) => {
    const authored = heading.id?.trim()
    return isNonEmptyText(authored) && !used.has(authored) ? reserve(authored) : undefined
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
    const preferred = Iterable.findFirst([heading.id?.trim(), slug], isNonEmptyText)
    const base = Option.getOrElse(preferred, () => `section-${Number.increment(index)}`)
    return reserve(availableHeadingId(base, used))
  })
}

const decodeNumericEntity = function decodeNumericEntity(entity: string): string {
  const isHexadecimal = entity[0].toLowerCase() === HEX_ENTITY_PREFIX
  const digits = isHexadecimal ? entity.slice(HEX_ENTITY_PREFIX.length) : entity
  const radix = isHexadecimal ? HEXADECIMAL_RADIX : DECIMAL_RADIX
  const codePoint = globalThis.Number.parseInt(digits, radix)
  return globalThis.String.fromCodePoint(Math.min(MAX_UNICODE_CODE_POINT, codePoint))
}

const textOf = function textOf(html: string): string {
  return sanitizeHtml(html, { allowedAttributes: {}, allowedTags: [] })
    .replaceAll(/&#(?<entity>x[0-9a-f]+|\d+);/giu, (_match, entity: string) => decodeNumericEntity(entity))
    .replaceAll('&quot;', '"')
    .replaceAll(/&apos;|&#39;/gu, "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/**
 * Add stable IDs before SSR so hash links and the table of contents work without JavaScript.
 *
 * @param {string} html The rendered Wiki HTML containing heading elements.
 * @returns {{html: string, toc: Heading[]}} The markup with stable heading IDs and its table of contents.
 */
export const decorateHeadings = function decorateHeadings(html: string): { html: string; toc: Heading[] } {
  const matches = [...html.matchAll(/<h(?<level>[1-3])(?<attributes>[^>]*)>(?<content>[\s\S]*?)<\/h[1-3]>/gu)]
  const headings = matches.map((match) => {
    const { level, attributes, content } = match.groups ?? {}
    const numericLevel = globalThis.Number(level)
    const text = textOf(content)
    const authored = HEADING_ID.exec(attributes)?.groups?.id
    return {
      id: isNonEmptyText(authored) ? textOf(authored) : undefined,
      level: numericLevel,
      text,
    }
  })
  const ids = assignHeadingIds(headings)
  const toc = headings.map(({ level, text }, index) => ({ id: ids[index], level, text }))
  const headingIndex = MutableRef.make(FIRST_HEADING_INDEX)
  const decorated = html.replaceAll(
    /<h(?<level>[1-3])(?<attributes>[^>]*)>/gu,
    (_match, level: string, attributes: string) => {
      const id = ids[MutableRef.getAndUpdate(headingIndex, Number.increment)]
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
      return `<h${level}${attributes.replaceAll(/\s+id="[^"]*"/gu, '')} id="${id}">`
    },
  )
  return { html: decorated, toc }
}
