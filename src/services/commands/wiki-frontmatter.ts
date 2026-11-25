import { Array, Iterable, Predicate } from 'effect'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { flattenError } from 'zod'

import { WikiFrontmatterSchema } from '#contracts/inputs/wiki.ts'
import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { MILLISECONDS_PER_SECOND } from '#contracts/time.ts'

import { ValidationError, validationIssues } from './errors.ts'

/*
 * PROJ-488 (R6): matches a leading `---\n<yaml>\n---\n` block, the standard frontmatter
 * convention. CRLF-tolerant since pages can be edited from any client. A page with no
 * leading `---` line has no frontmatter at all (not an error — frontmatter is optional).
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u

export interface WikiFrontmatterMeta {
  type: string | null
  tags: string[]
  status: string | null
  verifiedAt: number | null
  verifiedBy: string | null
  owners: string[]
  verifyInterval: number | null
  isTemplate: boolean
}

const EMPTY_WIKI_FRONTMATTER: WikiFrontmatterMeta = fieldsInOrder([
  ['type', JSON_NULL],
  ['tags', Array.empty<string>()],
  ['status', JSON_NULL],
  ['verifiedAt', JSON_NULL],
  ['verifiedBy', JSON_NULL],
  ['owners', Array.empty<string>()],
  ['verifyInterval', JSON_NULL],
  ['isTemplate', false],
])

/*
 * YAML 1.1 (what the `yaml` package parses by default) auto-converts an unquoted
 * `verified_at: 2026-01-01`-shaped scalar into a JS Date — Zod's z.number() would reject
 * that outright, so normalize before validation. A plain number is treated as an
 * already-unix-seconds value (matching this repo's timestamp convention); a string is
 * parsed as an ISO date. Throws a plain Error (caller wraps it as a ValidationError) on
 * anything else, or an unparseable string.
 */
const normalizeVerifiedAt = function normalizeVerifiedAt(value: unknown): number | null {
  if (value === JSON_NULL) {
    return JSON_NULL
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime() / MILLISECONDS_PER_SECOND)
  }
  if (Predicate.isNumber(value)) {
    return Math.floor(value)
  }
  if (Predicate.isString(value)) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`verified_at is not a valid date: '${value}'`)
    }
    return Math.floor(parsed.getTime() / MILLISECONDS_PER_SECOND)
  }
  throw new Error('verified_at must be a date or a unix-seconds number')
}

const parseFrontmatterYaml = function parseFrontmatterYaml(yamlBlock: string): unknown {
  try {
    return parseYaml(yamlBlock)
  } catch {
    /*
     * Never interpolate the third-party YAML parser's own exception message —
     * it can describe internal parser state, not just the caller's input.
     */
    throw new ValidationError(validationIssues(['Invalid YAML frontmatter'], {}))
  }
}

const normalizeFrontmatterRecord = function normalizeFrontmatterRecord(raw: object): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...raw }
  if ('verified_at' in normalized) {
    try {
      normalized.verified_at = normalizeVerifiedAt(normalized.verified_at)
    } catch (caughtError) {
      throw new ValidationError(
        validationIssues([caughtError instanceof Error ? caughtError.message : String(caughtError)], {}),
      )
    }
  }
  return normalized
}

/*
 * PROJ-488: parses+validates the optional frontmatter block out of a wiki page's raw
 * `content`. `content` itself is left untouched — frontmatter is denormalized into
 * columns purely for filtering; the canonical markdown (frontmatter included) keeps
 * round-tripping through create/update/revisions/diff exactly as before this feature.
 * Invalid YAML or a frontmatter value that fails schema validation throws a
 * ValidationError — this is intentionally never silently ignored or coerced.
 * An empty `---\n---\n` block parses to null/undefined — treat as "no frontmatter"
 * rather than an error, since it's an easy no-op state to end up in when editing.
 * Anything else that isn't a plain mapping (a list, a scalar) is a genuine error.
 */
const requireFrontmatterMapping = function requireFrontmatterMapping(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (Predicate.isNullish(raw)) {
    return undefined
  }
  if (!Predicate.isObject(raw)) {
    throw new ValidationError(
      validationIssues(['Frontmatter must be a YAML mapping (key: value pairs), not a list or scalar'], {}),
    )
  }
  return raw
}

const toFrontmatterMeta = function toFrontmatterMeta(
  data: ReturnType<typeof WikiFrontmatterSchema.parse>,
): WikiFrontmatterMeta {
  return fieldsInOrder([
    ['type', data.type ?? JSON_NULL],
    ['tags', data.tags ?? []],
    ['status', data.status ?? JSON_NULL],
    ['verifiedAt', data.verified_at ?? JSON_NULL],
    ['verifiedBy', data.verified_by ?? JSON_NULL],
    ['owners', data.owners ?? []],
    ['verifyInterval', data.verify_interval ?? JSON_NULL],
    ['isTemplate', data.template ?? false],
  ])
}

export const parseWikiFrontmatter = function parseWikiFrontmatter(content: string): WikiFrontmatterMeta {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) {
    return EMPTY_WIKI_FRONTMATTER
  }

  const raw = requireFrontmatterMapping(parseFrontmatterYaml(match[1]))
  if (Predicate.isNullish(raw)) {
    return EMPTY_WIKI_FRONTMATTER
  }

  const normalized = normalizeFrontmatterRecord(raw)
  const parsed = WikiFrontmatterSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new ValidationError(flattenError(parsed.error))
  }

  return toFrontmatterMeta(parsed.data)
}

/*
 * PROJ-491 (R9): strips the `template: true` frontmatter key when seeding a new page's
 * content from a template page — a page created FROM a template is not itself a template
 * unless the author explicitly adds the flag back. Every other frontmatter key (type,
 * tags, status, ...) carries over untouched. If stripping leaves no frontmatter keys at
 * all, the block is dropped entirely rather than left as an empty `---\n---\n` shell.
 */
export const stripTemplateFlag = function stripTemplateFlag(content: string): string {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) {
    return content
  }
  const rest = content.slice(match[0].length)

  const raw = parseYaml(match[1])
  if (!Predicate.isObject(raw)) {
    return content
  }
  const { template: _template, ...remaining } = raw
  if (Array.isArrayEmpty(Object.keys(remaining))) {
    return rest
  }

  const yamlText = stringifyYaml(remaining).trimEnd()
  return `---\n${yamlText}\n---\n${rest}`
}

const editableFrontmatterRecord = function editableFrontmatterRecord(
  match: RegExpExecArray | null,
): Record<string, unknown> {
  if (Predicate.isNullish(match)) {
    return {}
  }
  const parsed: unknown = parseYaml(match[1])
  return Predicate.isObject(parsed) ? { ...parsed } : {}
}

export const setWikiFrontmatterFields = function setWikiFrontmatterFields(
  content: string,
  values: Record<string, unknown>,
): string {
  const match = FRONTMATTER_RE.exec(content)
  const rest = match ? content.slice(match[0].length) : content

  const raw = editableFrontmatterRecord(match)

  Iterable.forEach(Object.entries(values), ([key, value]) => {
    if (value === JSON_NULL) {
      delete raw[key]
    } else {
      raw[key] = value
    }
  })

  if (Array.isArrayEmpty(Object.keys(raw))) {
    return rest
  }

  const yamlText = stringifyYaml(raw).trimEnd()
  return `---\n${yamlText}\n---\n${rest}`
}

export const stampWikiFrontmatterVerification = function stampWikiFrontmatterVerification(
  content: string,
  verifiedAtSeconds: number,
  verifiedBy: string,
): string {
  const match = FRONTMATTER_RE.exec(content)
  const rest = match ? content.slice(match[0].length) : content

  const raw = editableFrontmatterRecord(match)
  raw.verified_at = new Date(verifiedAtSeconds * MILLISECONDS_PER_SECOND).toISOString()
  raw.verified_by = verifiedBy

  const yamlText = stringifyYaml(raw).trimEnd()
  return `---\n${yamlText}\n---\n${rest}`
}
