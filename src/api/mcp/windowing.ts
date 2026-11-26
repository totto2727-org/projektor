import { Iterable, Predicate } from 'effect'

import { ValidationError, validationIssues } from '#contracts/errors.ts'

const TEXT_START_INDEX = 0
const CODE_UNIT_WIDTH = 1
const SURROGATE_PAIR_WIDTH = 2
const LINE_BREAK_WIDTH = 1
const FIRST_HEADING_INDEX = 0
const HEADING_INDEX_STEP = 1

/*
 * PROJ-892: windowed reads of long text (wiki pages, issue bodies) so one call never
 * returns an unbounded blob. Offsets are UTF-16 code units (JS string indices) and are
 * only ever placed on code-point boundaries, so a window never splits an emoji.
 */

export const WIKI_DEFAULT_MAX_CHARS = 8000
export const WIKI_MAX_CHARS = 20_000
export const ISSUE_BODY_MAX_CHARS = 16_000
export const LIST_BODY_MAX_CHARS = 1000

// High-surrogate code units span U+D800 to U+DBFF.
const HIGH_SURROGATE_START = 55_296
const HIGH_SURROGATE_END = 56_319
const FIRST_SUPPLEMENTARY_CODE_POINT = 0x1_00_00

const isHighSurrogateAt = function isHighSurrogateAt(text: string, index: number): boolean {
  const codePoint = text.codePointAt(index)
  return (
    Predicate.isNumber(codePoint) &&
    (codePoint >= FIRST_SUPPLEMENTARY_CODE_POINT ||
      (codePoint >= HIGH_SURROGATE_START && codePoint <= HIGH_SURROGATE_END))
  )
}

/**
 * Adjust the exclusive end so it does not split a surrogate pair.
 *
 * @param {string} text The source string.
 * @param {number} end The proposed end as a UTF-16 index.
 * @returns {number} The original end or the preceding UTF-16 index when it follows a high surrogate.
 */
const safeEnd = function safeEnd(text: string, end: number): number {
  if (end > TEXT_START_INDEX && end < text.length && isHighSurrogateAt(text, end - CODE_UNIT_WIDTH)) {
    return end - CODE_UNIT_WIDTH
  }
  return end
}

export interface TextWindow {
  text: string
  totalChars: number
  next?: string
}

/**
 * Window the text from the previous cursor, or from the start on the first request.
 * A window that starts with a surrogate pair allows both units so it can advance.
 *
 * @param {string} text The source string.
 * @param {{max: number, cursor?: string}} opts The limit in UTF-16 units and optional continuation cursor.
 * @returns {TextWindow} The text slice, its source length and a next cursor when more text follows.
 */
export const windowText = function windowText(text: string, opts: { max: number; cursor?: string }): TextWindow {
  let start = 0
  if (Predicate.isNotNullish(opts.cursor)) {
    start = Number(opts.cursor)
    if (!Number.isInteger(start) || start < TEXT_START_INDEX || start > text.length) {
      throw new ValidationError(validationIssues([], { cursor: ['invalid cursor'] }))
    }
  }
  let end = safeEnd(text, Math.min(text.length, start + opts.max))
  // A window smaller than one code point (max:1 on an emoji) must still make progress.
  if (end <= start && start < text.length) {
    end = start + (isHighSurrogateAt(text, start) ? SURROGATE_PAIR_WIDTH : CODE_UNIT_WIDTH)
  }
  return {
    text: text.slice(start, end),
    totalChars: text.length,
    ...(end < text.length ? { next: globalThis.String(end) } : {}),
  }
}

interface Heading {
  level: number
  text: string
  start: number
}

type HeadingRegion = 'first-line' | 'frontmatter' | 'content' | '```' | '~~~'
type HeadingScan = Readonly<{ headings: Heading[]; offset: number; region: HeadingRegion }>

const regionAfterLine = function regionAfterLine(region: HeadingRegion, line: string): HeadingRegion {
  if (region === 'first-line' && line.trim() === '---') {
    return 'frontmatter'
  }
  if (region === 'frontmatter') {
    return line.trim() === '---' ? 'content' : region
  }
  const marker = /^\s*(?<marker>```|~~~)/u.exec(line)?.groups?.marker
  if (marker !== '```' && marker !== '~~~') {
    return region === 'first-line' ? 'content' : region
  }
  if (region === '```' || region === '~~~') {
    return marker === region ? 'content' : region
  }
  return marker
}

const scanHeading = function scanHeading(scan: HeadingScan, line: string): HeadingScan {
  const region = regionAfterLine(scan.region, line)
  if (region === 'content') {
    const groups = /^(?<marks>#{1,6})\s+(?<text>.+?)\s*#*\s*$/u.exec(line)?.groups
    if (Predicate.isNotNullish(groups)) {
      scan.headings.push({ level: groups.marks.length, start: scan.offset, text: groups.text })
    }
  }
  return { headings: scan.headings, offset: scan.offset + line.length + LINE_BREAK_WIDTH, region }
}

/**
 * Read ATX headings outside fenced code blocks and the leading frontmatter block.
 *
 * @param {string} content The Markdown source.
 * @returns {Heading[]} Headings and their UTF-16 offsets in document order.
 */
const headings = function headings(content: string): Heading[] {
  const initial: HeadingScan = { headings: [], offset: 0, region: 'first-line' }
  return Iterable.reduce(content.split('\n'), initial, scanHeading).headings
}

/**
 * Build an outline in document order from the page's ATX headings.
 *
 * @param {string} content The Markdown source.
 * @returns {string[]} The heading lines, with a prefix such as `##` for each level.
 */
export const outlineOf = function outlineOf(content: string): string[] {
  return headings(content).map((heading) => `${'#'.repeat(heading.level)} ${heading.text}`)
}

const slugify = function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replaceAll(/\s+/gu, '-')
}

/**
 * The section titled `name` (matched on heading text or its slug, case-insensitively,
 * with or without leading #s): the heading through to the next heading of the same or a
 * higher level. Undefined on a miss.
 *
 * @param {string} content The Markdown source.
 * @param {string} name The heading text or slug to find.
 * @returns {string | undefined} The heading and its full section, or undefined if the heading is absent.
 */
export const sectionOf = function sectionOf(content: string, name: string): string | undefined {
  const wanted = name
    .replace(/^#+\s*/u, '')
    .trim()
    .toLowerCase()
  const hs = headings(content)
  const headingIndex = hs.findIndex(
    (heading) => heading.text.toLowerCase() === wanted || slugify(heading.text) === wanted,
  )
  if (headingIndex < FIRST_HEADING_INDEX) {
    return undefined
  }
  const next = hs.slice(headingIndex + HEADING_INDEX_STEP).find((heading) => heading.level <= hs[headingIndex].level)
  return content.slice(hs[headingIndex].start, next ? next.start : content.length).replace(/\n+$/u, '')
}

/**
 * Return the body preview requested by `bodyChars` on list operations.
 *
 * @param {unknown} body The body from the source record. Missing or non-string values read as empty text.
 * @param {number} chars The maximum number of UTF-16 code units.
 * @returns {{body: string, bodyTruncated?: true}} The body prefix, with a flag when the source was cut.
 */
export const bodyPreview = function bodyPreview(body: unknown, chars: number): { body: string; bodyTruncated?: true } {
  const text = Predicate.isString(body) ? body : ''
  if (text.length <= chars) {
    return { body: text }
  }
  return { body: text.slice(TEXT_START_INDEX, safeEnd(text, chars)), bodyTruncated: true }
}
