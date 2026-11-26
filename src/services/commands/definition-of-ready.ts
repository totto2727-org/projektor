/*
 * Heuristic definition-of-ready check (PROJ-253/291, spec: docs/design/agentic-workflow.md
 * Phase 3). Deliberately a text heuristic over the existing body field, not a new
 * structured schema — the epic's own child issues are already written this way, and a
 * schema change would break every existing issue's readiness overnight.
 */

import { Array, String, Number } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { SQLITE_FALSE, SQLITE_TRUE } from '#db/sqlite-boolean.ts'

const SEPARATOR_NOT_FOUND = -1
const INLINE_LIST_START = 1
const INLINE_LIST_END = -1

export interface ReadinessCheck {
  ready: boolean
  missing: string[]
}

// Does the line introduce a new section (so a section started earlier has ended)?
const isSectionBoundary = function isSectionBoundary(line: string): boolean {
  return /^#{1,6}\s/u.test(line) || /^\*\*[A-Za-z][^*]*\*\*:?\s*$/u.test(line)
}

const ci = function ci(source: string, flags: string): RegExp {
  return new RegExp(source, flags.includes('i') ? 'i' : '')
}

/*
 * PROJ-859: the per-label regexes are compiled once per label (and cached), not once
 * per line — this used to rebuild two RegExps for every line of every open issue.
 */
interface LabelMatchers {
  word: RegExp
  prefix: RegExp
}
const matcherCache = new Map<string, LabelMatchers>()
const labelMatchers = function labelMatchers(label: RegExp): LabelMatchers {
  const key = `${label.source}/${label.flags}`
  let matchers = matcherCache.get(key)
  if (!matchers) {
    matchers = {
      word: ci(`\\b(?:${label.source})\\b`, label.flags),
      prefix: ci(`^\\s*(?:${label.source})\\b[^:—–]*[:—–]`, label.flags),
    }
    matcherCache.set(key, matchers)
  }
  return matchers
}

// Is `line` a STRUCTURAL label line for `label` — a heading, a bold label, or a
// "Label:"-prefixed line — rather than prose that merely mentions the phrase
// (PROJ-291)? "## Scope / files", "**Acceptance criteria**", "Verification:" pass;
// "acceptance criteria are unclear" does not.
const isLabelLine = function isLabelLine(line: string, matchers: LabelMatchers): boolean {
  const trimmedLine = line.trim()

  const isHeading = /^#{1,6}\s+/u.test(trimmedLine)
  const isBold = /^\*\*[^*]+\*\*:?\s*$/u.test(trimmedLine) || /^[-*]\s+\*\*[^*]+\*\*/u.test(trimmedLine)
  if (isHeading || isBold) {
    return matchers.word.test(trimmedLine)
  }

  // A plain line only counts when the label is a "Label:" prefix, not mid-sentence.
  const stripped = trimmedLine.replace(/^[-*]\s+/u, '').replaceAll('**', '')
  return matchers.prefix.test(stripped)
}

/*
 * Non-empty content for `label`'s section: inline after a "Label:" or on a following
 * non-blank line before the next section boundary.
 */
const sectionHasContent = function sectionHasContent(body: string, label: RegExp): boolean {
  const lines = body.split(/\r?\n/u)
  const matchers = labelMatchers(label)
  const idx = lines.findIndex((line) => isLabelLine(line, matchers))
  if (idx === SEPARATOR_NOT_FOUND) {
    return false
  }

  const inline = lines[idx]
    .replace(/^[#\-*\s]+/u, '')
    .replaceAll('**', '')
    .replaceAll('`', '')
  const sepIdx = inline.search(/[:—–]/u)
  const afterColon = sepIdx === SEPARATOR_NOT_FOUND ? '' : inline.slice(Number.increment(sepIdx)).trim()
  if (String.isNonEmpty(afterColon)) {
    return true
  }

  for (let index = Number.increment(idx); index < lines.length; index = Number.increment(index)) {
    const line = lines[index].trim()
    if (String.isEmpty(line)) {
      continue
    }
    if (isSectionBoundary(line)) {
      break
    }
    return true
  }
  return false
}

/*
 * A path-shaped token inside an inline code span: contains a directory separator or a
 * filename.ext. A lone span like `true` no longer satisfies "scope/files" (PROJ-291).
 */
const hasFilePathToken = function hasFilePathToken(body: string): boolean {
  const spans = body.match(/`[^`\n]+`/gu)
  if (!spans) {
    return false
  }
  return spans.some((span) => {
    const inner = span.slice(INLINE_LIST_START, INLINE_LIST_END).trim()
    return inner.includes('/') || /[\w-]+\.[A-Za-z]{1,5}\b/u.test(inner)
  })
}

export const checkDefinitionOfReady = function checkDefinitionOfReady(body: string): ReadinessCheck {
  const missing: string[] = []

  if (!sectionHasContent(body, /acceptance criteria|\bAC\b/i)) {
    missing.push('acceptance criteria')
  }

  const hasScopeSection = sectionHasContent(body, /scope|files?/i)
  if (!hasScopeSection && !hasFilePathToken(body)) {
    missing.push('scope/files')
  }

  return fieldsInOrder([
    ['ready', Array.isArrayEmpty(missing)],
    ['missing', missing],
  ])
}

/**
 * PROJ-859: the stored-column form of checkDefinitionOfReady — [dor_ready, dor_missing].
 *
 * @param {string | null | undefined} body The issue body. A missing body is treated as empty text.
 * @returns {[number, string]} The SQLite readiness flag and the missing fields encoded as JSON.
 */
export const dorColumns = function dorColumns(body: string | null | undefined): [number, string] {
  const { ready, missing } = checkDefinitionOfReady(body ?? '')
  return [ready ? SQLITE_TRUE : SQLITE_FALSE, JSON.stringify(missing)]
}
