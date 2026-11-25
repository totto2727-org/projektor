import { String, Array, Iterable, Predicate, Number, Option } from 'effect'
import { z } from 'zod'

import { ValidationError } from '#contracts/errors.ts'
import { JSON_NULL } from '#contracts/json-null.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

/*
 * PROJ-891 (builds on PROJ-931): MCP-only response shaping. Applied in the MCP layer, not
 * the service, so REST keeps returning the full shape — the service is the single source
 * of truth for the data, this is presentation for the token-metered MCP surface.
 * Conventions: apps/docs/src/content/docs/agents/response-conventions.md.
 */

export const RESPONSE_CONVENTIONS_DOC = '/projektor/agents/response-conventions/'

/** Every tool description that shapes results says this, so a caller sees the contract. */
export const OMISSION_NOTE = `Omitted keys are null/empty/false; pass verbose:true for the raw shape. See ${RESPONSE_CONVENTIONS_DOC}.`

/** Per-result size ceiling (characters of serialized JSON). */
export const MAX_RESULT_CHARS = 20_000
const MIN_CAPPED_ITEMS = 1

/*
 * Every key any issue-returning tool can emit (get_issue's full shape ∪ list items ∪ the
 * derived `ref`/`type`/`updated`). `fields` is checked against this so a typo is a
 * validation error, not a silent `null`.
 */
export const ISSUE_FIELD_NAMES = [
  'ref',
  'type',
  'updated',
  'id',
  'workspace_id',
  'project_id',
  'number',
  'title',
  'body',
  'bodyTruncated',
  'status',
  'priority',
  'assignee_id',
  'assignee_name',
  'labels',
  'parent_id',
  'type_id',
  'status_id',
  'status_category',
  'sprint_id',
  'created_by_id',
  'author_kind',
  'created_at',
  'updated_at',
  'completed_at',
  'needs_audit',
  'project_key',
  'project_name',
  'type_key',
  'type_name',
  'status_key',
  'status_name',
  'rollup',
  'links',
  'customFields',
  'url',
] as const

export const VIEW_FIELDS_PROPS = {
  ...fieldsInOrder([
    [
      'view',
      fieldsInOrder([
        ['type', 'string'],
        ['enum', ['summary', 'full']],
        [
          'description',
          'summary = {ref,title,status,priority,type,parent?,assignee?,updated} per issue; ' +
            'full (default) = every non-empty field. See ' +
            RESPONSE_CONVENTIONS_DOC,
        ],
      ]),
    ],
    [
      'verbose',
      fieldsInOrder([
        ['type', 'boolean'],
        ['description', 'Include normally-omitted empty/default/internal fields (default false)'],
      ]),
    ],
    [
      'fields',
      fieldsInOrder([
        ['type', ['array', 'string']],
        ['items', { type: 'string' }],
        [
          'description',
          'Return only these fields (array, or comma-separated string), with their real values ' +
            '(null if the issue has no such value). Every named field is always present. Unknown ' +
            `names are rejected. See ${RESPONSE_CONVENTIONS_DOC}`,
        ],
      ]),
    ],
  ]),
} as const

const shapeOptionFields = fieldsInOrder([
  ['view', z.enum(['summary', 'full']).optional()],
  ['verbose', z.boolean().optional()],
  [
    'fields',
    z
      .union([z.string(), z.array(z.string())])
      .transform((csv) =>
        (Predicate.isString(csv) ? csv.split(',') : csv)
          .map((entry) => entry.trim())
          .filter((entry) => String.isNonEmpty(entry)),
      )
      .pipe(z.array(z.enum(ISSUE_FIELD_NAMES)).max(ISSUE_FIELD_NAMES.length))
      .optional(),
  ],
])

const ShapeOptsSchema = z.object(shapeOptionFields)

export type ShapeOpts = z.infer<typeof ShapeOptsSchema>

/**
 * Pulls the MCP-only view/verbose/fields options out of the raw tool input before it
 * reaches the (`.strict()`) service schema, validating them first.
 *
 * @param {unknown} input The unvalidated MCP tool input.
 * @returns {{rest: Record<string, unknown>} & ShapeOpts} The validated shaping options and remaining service input.
 */
export const splitShapeOpts = function splitShapeOpts(input: unknown): { rest: Record<string, unknown> } & ShapeOpts {
  const { view, verbose, fields, ...rest } = (input ?? {}) as Record<string, unknown>
  const result = ShapeOptsSchema.safeParse(
    fieldsInOrder([
      ['view', view],
      ['verbose', verbose],
      ['fields', fields],
    ]),
  )
  if (!result.success) {
    throw new ValidationError(z.flattenError(result.error))
  }
  return { rest, ...result.data }
}

const isEmptyArray = function isEmptyArray(value: unknown): boolean {
  return globalThis.Array.isArray(value) && Array.isArrayEmpty(value)
}

const parseLabels = function parseLabels(value: unknown): string[] | undefined {
  if (globalThis.Array.isArray(value)) {
    return value.filter((label): label is string => Predicate.isString(label))
  }
  if (!Predicate.isString(value)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(value)
    return globalThis.Array.isArray(parsed)
      ? parsed.filter((label): label is string => Predicate.isString(label))
      : undefined
  } catch {
    return undefined
  }
}

const isZeroRollup = function isZeroRollup(value: unknown): boolean {
  return Predicate.isObjectOrArray(value) && (value as { total?: unknown }).total === 0
}

/*
 * Dropped when null/unset: a caller checks the id, and the key/name pair only exists to
 * save a lookup, so it is noise once the id is gone.
 */
const NULLABLE_DEFAULT_KEYS = ['sprint_id', 'parent_id', 'completed_at', 'author_kind', 'status_category'] as const

/*
 * Internal ids a caller never needs: the workspace is the URL, the project is in `ref`,
 * type/status are named by `type`/`status`, and the author is in `author_kind`.
 */
const INTERNAL_ID_KEYS = ['workspace_id', 'project_id', 'type_id', 'status_id', 'created_by_id'] as const

// Name/key duplicates of things kept elsewhere: `ref` carries project_key + number,
// `type` carries type_key, and `status` carries the state.
const DUPLICATE_KEYS = ['project_key', 'project_name', 'type_key', 'type_name', 'status_key', 'status_name'] as const

/**
 * Derive a reference such as `PROJ-42` from the joined project key and issue number.
 *
 * @param {Record<string, unknown>} issue The raw issue row.
 * @returns {string | undefined} The reference when the row contains both required fields.
 */
const refOf = function refOf(issue: Record<string, unknown>): string | undefined {
  return Predicate.isString(issue.project_key) && Predicate.isNumber(issue.number)
    ? `${issue.project_key}-${issue.number}`
    : undefined
}

/**
 * Select the fields needed to triage and address an issue in the summary view.
 *
 * @param {Record<string, unknown>} issue The raw issue row, including any requested body preview.
 * @returns {Record<string, unknown>} The summary fields, including a reference or ID when available.
 */
const summarize = function summarize(issue: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const ref = refOf(issue)
  if (Predicate.isNotNullish(ref) && String.isNonEmpty(ref)) {
    out.ref = ref
  } else if (Predicate.isNotNullish(issue.id)) {
    out.id = issue.id
  }
  out.title = issue.title
  out.status = issue.status
  out.priority = issue.priority
  if (Predicate.isNotNullish(issue.type_key)) {
    out.type = issue.type_key
  }
  // Until refs are available on parents (PROJ-890) this is the parent's id.
  if (Predicate.isNotNullish(issue.parent_id)) {
    out.parent = issue.parent_id
  }
  const assignee = issue.assignee_name ?? issue.assignee_id
  if (Predicate.isNotNullish(assignee)) {
    out.assignee = assignee
  }
  out.updated = issue.updated_at
  // PROJ-892: present only when the caller asked for a body preview (bodyChars).
  if (Predicate.isString(issue.body)) {
    out.body = issue.body
  }
  if (issue.bodyTruncated) {
    out.bodyTruncated = true
  }
  return out
}

/**
 * One serializer for every issue the MCP surface returns.
 *
 * - `fields`: an allowlist. Every named key is present with its real value (null only when
 *   the issue has no such value) so `fields:["assignee_id"]` never returns `{}`.
 * - `verbose`: the raw service shape, untouched.
 * - `view:"summary"`: the compact triage shape.
 * - otherwise (`full`, the default): drops null/empty/false defaults and internal ids,
 *   parses `labels` to an array, and adds `ref` and `type`.
 *
 * @param {Record<string, unknown>} issue The raw issue result from the service.
 * @param {ShapeOpts} [opts] The requested field allowlist, verbose mode or named view.
 * @returns {Record<string, unknown>} The issue in the requested MCP response shape.
 */
export const shapeIssue = function shapeIssue(
  issue: Record<string, unknown>,
  opts: ShapeOpts = {},
): Record<string, unknown> {
  const ref = refOf(issue)
  if (opts.fields && Array.isArrayNonEmpty(opts.fields)) {
    const source: Record<string, unknown> = {
      ...issue,
      ref,
      type: issue.type_key,
      updated: issue.updated_at,
    }
    const picked: Record<string, unknown> = {}
    Iterable.forEach(opts.fields, (field) => {
      picked[field] = Object.hasOwn(source, field) ? (source[field] ?? JSON_NULL) : JSON_NULL
    })
    return picked
  }
  if (opts.verbose === true) {
    return issue
  }
  if (opts.view === 'summary') {
    return summarize(issue)
  }

  const out: Record<string, unknown> = { ...issue }
  if (Predicate.isNotNullish(ref) && String.isNonEmpty(ref)) {
    out.ref = ref
  }
  if (Predicate.isNotNullish(issue.type_key)) {
    out.type = issue.type_key
  }
  const labels = parseLabels(out.labels)
  if (labels && Array.isArrayNonEmpty(labels)) {
    out.labels = labels
  } else {
    delete out.labels
  }
  if (isEmptyArray(out.links)) {
    delete out.links
  }
  if (isZeroRollup(out.rollup)) {
    delete out.rollup
  }
  if (isEmptyArray(out.customFields)) {
    delete out.customFields
  }
  if (!Predicate.isNotNullish(out.assignee_id)) {
    delete out.assignee_id
    delete out.assignee_name
  }
  if (out.needs_audit === false || out.needs_audit === 0) {
    delete out.needs_audit
  }
  Iterable.forEach(NULLABLE_DEFAULT_KEYS, (key) => {
    const value = out[key]
    if (Predicate.isNullish(value) || (Predicate.isString(value) && String.isEmpty(value))) {
      delete out[key]
    }
  })
  Iterable.forEach(INTERNAL_ID_KEYS, (key) => {
    delete out[key]
  })
  Iterable.forEach(DUPLICATE_KEYS, (key) => {
    delete out[key]
  })
  /*
   * `status` is the legacy enum; a custom workflow status (e.g. "qa" within in_progress)
   * is only distinguishable by its key, so keep it whenever it adds information.
   */
  if (Predicate.isString(issue.status_key) && issue.status_key !== issue.status) {
    out.status_key = issue.status_key
  }
  return out
}

/**
 * Assemble the shared MCP list response shape.
 *
 * @param {T[]} items The rows on this page.
 * @param {string | number | null} [next] The cursor for the following page, when available.
 * @param {Record<string, unknown>} [extra] Additional fields supplied by the tool.
 * @returns {{items: T[], next?: string} & Record<string, unknown>} The list response with a string cursor when present.
 */
export const toPage = function toPage<T>(
  items: T[],
  next?: string | number | null,
  extra: Record<string, unknown> = {},
): { items: T[]; next?: string } & Record<string, unknown> {
  return { items, ...(Predicate.isNotNullish(next) ? { next: globalThis.String(next) } : {}), ...extra }
}

const largestFittingCount = function largestFittingCount(
  lower: number,
  upper: number,
  fits: (count: number) => boolean,
): number {
  if (lower >= upper) {
    return lower
  }
  const middle = Math.ceil((lower + upper) / 2)
  return fits(middle)
    ? largestFittingCount(middle, upper, fits)
    : largestFittingCount(lower, Number.decrement(middle), fits)
}

const largestResumableCount = function largestResumableCount(
  upper: number,
  canCutAt: (count: number) => boolean,
): number {
  if (upper <= MIN_CAPPED_ITEMS) {
    return upper
  }
  const counts = Iterable.makeBy((offset) => upper - offset, { length: upper - MIN_CAPPED_ITEMS })
  return Option.getOrElse(Iterable.findFirst(counts, canCutAt), () => MIN_CAPPED_ITEMS)
}

/**
 * Keeps a `{items, ...}` result under `max` serialized chars by dropping trailing items,
 * so the JSON is never cut mid-document. `truncated:true` marks that it happened.
 *
 * `cursorOf(i)` returns the cursor that resumes after item `i`; when a tool has no such
 * cursor the result carries a `hint` to lower `limit` or narrow the filters instead, and
 * any pre-existing `next` is dropped (it would skip the items that were cut).
 *
 * @param {P} page The uncapped page, including any tool-specific fields and next cursor.
 * @param {{max?: number, cursorOf?: (index: number) => (string | undefined), canCutAt?: (kept: number) => boolean}} [opts]
 * The size ceiling, cursor lookup for the last kept item and optional safe-cut check.
 * @returns {P & {truncated?: true, hint?: string}} The original or truncated page with a resume cursor or hint as available.
 */
export const capPage = function capPage<P extends { items: unknown[]; next?: string }>(
  page: P,
  opts: {
    max?: number
    cursorOf?: (index: number) => string | undefined
    /** Whether the page may end after `kept` items (e.g. not mid-way through one timestamp). */
    canCutAt?: (kept: number) => boolean
  } = {},
): P & { truncated?: true; hint?: string } {
  const max = opts.max ?? MAX_RESULT_CHARS
  if (Array.isArrayEmpty(page.items) || JSON.stringify(page).length <= max) {
    return page
  }

  const build = (keptCount: number) => {
    const { next: _drop, ...rest } = page
    const cursor = opts.cursorOf?.(Number.decrement(keptCount))
    return {
      ...rest,
      items: page.items.slice(0, keptCount),
      truncated: true as const,
      ...(Predicate.isNotNullish(cursor) && String.isNonEmpty(cursor) ? { next: cursor } : {}),
      ...(opts.cursorOf ? {} : { hint: `Result capped at ${max} chars; lower limit or narrow the filters.` }),
    } as P & { truncated: true; hint?: string }
  }

  // Largest k (≥1) whose serialized form fits; one oversized item is still returned whole.
  const fittingCount = largestFittingCount(
    MIN_CAPPED_ITEMS,
    page.items.length,
    (count) => JSON.stringify(build(count)).length <= max,
  )
  /*
   * Back off to a cut the tool says is resumable. If none exists (e.g. every event shares
   * one second), an over-cap page is better than a cursor that silently skips items.
   */
  const keptCount = largestResumableCount(fittingCount, (count) => !opts.canCutAt || opts.canCutAt(count))
  if (opts.canCutAt && !opts.canCutAt(keptCount)) {
    return page
  }
  return build(keptCount)
}
