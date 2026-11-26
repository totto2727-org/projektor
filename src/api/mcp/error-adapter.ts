import { String, Array, Iterable, Predicate } from 'effect'
import { CorePublicError } from 'projektor/core-client'
import { z } from 'zod'

import { ConflictError, NotFoundError, ServiceError, ValidationError } from '#contracts/errors.ts'
import type { ZodFlattenOutput } from '#contracts/errors.ts'
import { HTTP_INTERNAL_SERVER_ERROR } from '#contracts/http-status.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { JSON_RPC_INVALID_PARAMS } from './json-rpc.ts'

const MCP_SERVER_ERROR_CODE = -32_000

// oxlint-disable-next-line unicorn/no-null -- The MCP error adapter's null result signals that the route should return a JSON-RPC error.
const NO_TOOL_ERROR = null

const validationIssueFields = fieldsInOrder([
  ['formErrors', z.array(z.string())],
  ['fieldErrors', z.record(z.string(), z.array(z.string()).optional())],
])

const ValidationIssues = z.object(validationIssueFields)

const rpcErrorWithData = function rpcErrorWithData(
  code: number,
  message: string,
  data: unknown,
): { code: number; message: string; data: unknown } {
  return fieldsInOrder([
    ['code', code],
    ['message', message],
    ['data', data],
  ])
}

const MAX_DETAIL_VALUE_CHARS = 80
const MAX_DETAIL_SUMMARY_CHARS = 300

const truncate = function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const renderDetailValue = function renderDetailValue(value: unknown): string {
  if (globalThis.Array.isArray(value)) {
    return value.join(', ')
  }
  return Predicate.isString(value) ? value : JSON.stringify(value)
}

/*
 * Not every MCP host surfaces the JSON-RPC 2.0 `error.data` member to the calling
 * model — many render only `code`/`message`. `data` stays the primary, complete
 * machine-readable channel, but a bounded human-readable summary is folded into
 * `message` too so an agent without `data` access isn't left blind to *why* a
 * structured error (conflict diff, ambiguous headings, ...) happened.
 */
const summarizeDetails = function summarizeDetails(details: Record<string, unknown>): string {
  const summary = Object.entries(details)
    .map(([key, value]) => {
      const rendered = renderDetailValue(value)
      return `${key}: ${truncate(rendered, MAX_DETAIL_VALUE_CHARS)}`
    })
    .join('; ')
  return truncate(summary, MAX_DETAIL_SUMMARY_CHARS)
}

const hasDetails = function hasDetails(
  details: Record<string, unknown> | undefined,
): details is Record<string, unknown> {
  return Predicate.isNotNullish(details) && Array.isArrayNonEmpty(Object.keys(details))
}

/*
 * Same bounded-summary treatment as NotFoundError/ConflictError's `details`, but for
 * ValidationError's Zod-flattened `issues` shape (formErrors + fieldErrors) instead of
 * a flat details object.
 */
const summarizeIssues = function summarizeIssues(issues: ZodFlattenOutput): string {
  const parts: string[] = [
    ...(Array.isArrayNonEmpty(issues.formErrors)
      ? [truncate(issues.formErrors.join(', '), MAX_DETAIL_VALUE_CHARS)]
      : []),
    ...Object.entries(issues.fieldErrors)
      .filter(([, messages]) => messages && Array.isArrayNonEmpty(messages))
      .map(([field, messages]) => `${field}: ${truncate(messages?.join(', ') ?? '', MAX_DETAIL_VALUE_CHARS)}`),
  ]
  return truncate(parts.join('; '), MAX_DETAIL_SUMMARY_CHARS)
}

const hasIssues = function hasIssues(issues: ZodFlattenOutput): boolean {
  return (
    Array.isArrayNonEmpty(issues.formErrors) ||
    Object.values(issues.fieldErrors).some((messages) => messages && Array.isArrayNonEmpty(messages))
  )
}

/*
 * PROJ-508/PROJ-523: surface the Zod issue detail (formErrors/fieldErrors) via the
 * JSON-RPC 2.0 `error.data` member instead of dropping it. This covers ordinary
 * schema-validation failures and hand-thrown ValidationErrors alike (e.g.
 * patch_wiki_page's ambiguous-heading case), so an MCP agent can always read back
 * *why* its params were rejected, not just that they were. A bounded summary is also
 * folded into `message` — same fallback as NotFoundError/ConflictError below — for MCP
 * hosts that don't surface `data`.
 */
const toMcpValidationError = function toMcpValidationError(err: { issues: ZodFlattenOutput }): {
  code: number
  message: string
  data?: unknown
} {
  if (!hasIssues(err.issues)) {
    return rpcErrorWithData(JSON_RPC_INVALID_PARAMS, 'Invalid params', err.issues)
  }
  return rpcErrorWithData(JSON_RPC_INVALID_PARAMS, `Invalid params (${summarizeIssues(err.issues)})`, err.issues)
}

/*
 * PROJ-490 / PROJ-508 / PROJ-484: structured details (e.g. patch_wiki_page's
 * currentHeadings, or wiki's currentRevisionId + diff) travel in `data` — the proper
 * JSON-RPC 2.0 channel — rather than JSON-encoded into `message`. A bounded summary is
 * also folded into `message` as a fallback for MCP hosts that don't surface `data`.
 */
const toMcpServiceErrorWithDetails = function toMcpServiceErrorWithDetails(
  message: string,
  details: Record<string, unknown> | undefined,
): { code: number; message: string; data?: unknown } {
  if (!hasDetails(details)) {
    return { code: -32_000, message }
  }
  return rpcErrorWithData(MCP_SERVER_ERROR_CODE, `${message} (${summarizeDetails(details)})`, details)
}

export const toMcpError = function toMcpError(
  err: unknown,
  requestId: string,
): { code: number; message: string; data?: unknown } {
  if (err instanceof CorePublicError && err.status < HTTP_INTERNAL_SERVER_ERROR) {
    if (err.kind === 'validation') {
      const parsed = ValidationIssues.safeParse(err.details)
      if (parsed.success) {
        return toMcpValidationError({ issues: parsed.data })
      }
    }
    return toMcpServiceErrorWithDetails(err.message, err.details)
  }
  if (err instanceof ValidationError) {
    return toMcpValidationError(err)
  }
  if (err instanceof ServiceError) {
    /*
     * Only the kinds whose messages are deliberately client-facing are
     * surfaced (audited 2026-06-30: not_found / forbidden / conflict messages
     * are controlled domain strings — "Issue not found", "Slug already taken",
     * or the caller's own key echoed back — never internals). Any other
     * ServiceError kind is treated as internal so a future subclass can't
     * leak its message to clients by default. (PROJ-204)
     */
    switch (err.kind) {
      case 'not_found': {
        return toMcpServiceErrorWithDetails(err.message, err instanceof NotFoundError ? err.details : undefined)
      }
      case 'forbidden': {
        return { code: -32_000, message: err.message }
      }
      case 'conflict': {
        return toMcpServiceErrorWithDetails(err.message, err instanceof ConflictError ? err.details : undefined)
      }
      default: {
        console.error(`[mcp] unhandled ServiceError kind (request ${requestId}):`, err.kind, err)
        return rpcErrorWithData(MCP_SERVER_ERROR_CODE, `Internal error (request: ${requestId})`, { requestId })
      }
    }
  }
  console.error(`[mcp] unhandled error in tools/call (request ${requestId}):`, err)
  return rpcErrorWithData(MCP_SERVER_ERROR_CODE, `Internal error (request: ${requestId})`, { requestId })
}

/*
 * ---------------------------------------------------------------------------
 * PROJ-893: tool execution failures are tool *results* (`isError: true`), not JSON-RPC
 * protocol errors. The MCP spec puts them there so the model sees the failure and can
 * self-correct; a client only MAY show a protocol error to the model. JSON-RPC errors
 * (toMcpError above) stay reserved for protocol faults — parse error, invalid request,
 * method not found, unknown tool — and for an unexpected internal failure, whose
 * message must never carry anything but a request id.
 *
 * The code set is the kinds services already throw (services/errors.ts: PROJ-878's
 * not_found / forbidden / conflict / validation / payload_too_large) plus rate_limited,
 * which the request-limiter work (PROJ-899) will produce. Scope denials are neither: they
 * stay an HTTP 403 with a WWW-Authenticate challenge (PROJ-651), handled in routes/mcp.ts.
 * ---------------------------------------------------------------------------
 */

export type ToolErrorCode = 'not_found' | 'forbidden' | 'conflict' | 'validation' | 'payload_too_large' | 'rate_limited'

export interface ToolErrorBody {
  code: ToolErrorCode
  message: string
  /** Per-field problems, for `validation`. */
  fields?: Record<string, string[]>
  /** A concrete next step the model can take. */
  hint?: string
  /** Structured extras a service attached (a wiki conflict diff, the current headings, …). */
  details?: Record<string, unknown>
}

export interface ToolErrorResult {
  content: { type: 'text'; text: string }[]
  isError: true
}

export interface ToolErrorContext {
  /** The tool that was called — hints name the tool that would have found the thing. */
  toolName?: string
  /** The caller's effective role, so a `forbidden` hint can say what is missing. */
  role?: string
}

export const toolErrorResult = function toolErrorResult(error: ToolErrorBody): ToolErrorResult {
  return {
    content: [
      fieldsInOrder([
        ['type', 'text'],
        ['text', JSON.stringify({ error })],
      ]),
    ],
    isError: true,
  }
}

const definedFields = function definedFields(
  fieldErrors: ZodFlattenOutput['fieldErrors'],
): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {}
  Iterable.forEach(Object.entries(fieldErrors), ([field, messages]) => {
    if (messages && Array.isArrayNonEmpty(messages)) {
      out[field] = messages
    }
  })
  return Array.isArrayNonEmpty(Object.keys(out)) ? out : undefined
}

const pickNotFoundHint = function pickNotFoundHint(subject: string): string | undefined {
  if (subject.includes('wiki') || subject.includes('page')) {
    return 'Wiki pages are addressed by slug. Use search_wiki or wiki_tree to find one.'
  }
  if (subject.includes('agent session') || subject.includes('session')) {
    return 'Sessions come from register_agent; an ended session no longer exists to call.'
  }
  if (subject.includes('issue')) {
    return 'Refs look like PROJ-42 (project key + number). Use search_issues to find one.'
  }
  if (subject.includes('project')) {
    return 'Projects are addressed by UUID or key (e.g. PROJ). Use list_projects to see them.'
  }
  return undefined
}

const notFoundHint = function notFoundHint(message: string, toolName: string | undefined): string {
  // The message says what was missing; the tool name is only a fallback (claim_issue's
  // "Agent session not found" must not be read as an issue miss).
  const fromMessage = pickNotFoundHint(message.toLowerCase())
  if (Predicate.isNotNullish(fromMessage) && String.isNonEmpty(fromMessage)) {
    return fromMessage
  }
  return (
    pickNotFoundHint((toolName ?? '').toLowerCase()) ??
    'Check the id or ref. Use the matching search_ or list_ tool to look it up.'
  )
}

const conflictHint = function conflictHint(message: string, details: Record<string, unknown> | undefined): string {
  if (details && 'currentRevisionId' in details) {
    return 'The page changed since you read it. Re-read it with get_wiki_page, then apply your change with patch_wiki_page.'
  }
  if (/wip limit/iu.test(message)) {
    return 'Finish or release one of the issues listed as currently held, then claim again.'
  }
  return "Someone else's change got there first. Re-read the current state and retry."
}

/**
 * The tool-result form of a failed tools/call, or null when the failure is not one the
 * model can act on (an unexpected internal error — the caller keeps the JSON-RPC
 * "Internal error (request: …)" for those, which never leaks internals).
 *
 * @param {unknown} err The failure reported by the tool or Core.
 * @param {ToolErrorContext} ctx The tool context used to select a recovery hint.
 * @returns {ToolErrorResult | null} The tool error and recovery details, or null for an unexpected failure.
 */
export const toToolError = function toToolError(err: unknown, ctx: ToolErrorContext = {}): ToolErrorResult | null {
  if (err instanceof CorePublicError) {
    if (err.status >= HTTP_INTERNAL_SERVER_ERROR) {
      return NO_TOOL_ERROR
    }
    if (err.kind === 'validation') {
      const parsed = ValidationIssues.safeParse(err.details)
      if (!parsed.success) {
        return NO_TOOL_ERROR
      }
      const fields = definedFields(parsed.data.fieldErrors)
      return toolErrorResult({
        code: 'validation',
        message: parsed.data.formErrors.join('; ') || 'Invalid arguments',
        ...(fields ? { fields, hint: `Fix ${Object.keys(fields).join(', ')} and retry.` } : {}),
      })
    }
    if (err.kind === 'not_found') {
      return toolErrorResult({
        ...fieldsInOrder([
          ['code', 'not_found'],
          ['message', err.message],
          ['hint', notFoundHint(err.message, ctx.toolName)],
        ]),
        ...(hasDetails(err.details) ? { details: err.details } : {}),
      })
    }
    if (err.kind === 'conflict') {
      return toolErrorResult({
        ...fieldsInOrder([
          ['code', 'conflict'],
          ['message', err.message],
          ['hint', conflictHint(err.message, err.details)],
        ]),
        ...(hasDetails(err.details) ? { details: err.details } : {}),
      })
    }
    if (err.kind === 'forbidden') {
      return toolErrorResult(
        fieldsInOrder([
          ['code', 'forbidden'],
          ['message', err.message],
          [
            'hint',
            isNonEmptyText(ctx.role)
              ? `Your workspace role is ${ctx.role}; this may need a higher workspace or project role (members write, admins and owners manage).`
              : 'Your role does not allow this; members write, admins and owners manage.',
          ],
        ]),
      )
    }
    if (err.kind === 'payload_too_large') {
      return toolErrorResult(
        fieldsInOrder([
          ['code', 'payload_too_large'],
          ['message', err.message],
          ['hint', 'Send less data, or split it across several calls.'],
        ]),
      )
    }
    return NO_TOOL_ERROR
  }
  if (err instanceof ValidationError) {
    const fields = definedFields(err.issues.fieldErrors)
    const message = Array.isArrayNonEmpty(err.issues.formErrors)
      ? err.issues.formErrors.join('; ')
      : 'Invalid arguments'
    return toolErrorResult({
      code: 'validation',
      message,
      ...(fields ? { fields } : {}),
      ...(fields ? { hint: `Fix ${Object.keys(fields).join(', ')} and retry.` } : {}),
    })
  }
  if (!(err instanceof ServiceError)) {
    return NO_TOOL_ERROR
  }

  switch (err.kind) {
    case 'not_found': {
      const details = err instanceof NotFoundError ? err.details : undefined
      return toolErrorResult({
        ...fieldsInOrder([
          ['code', 'not_found'],
          ['message', err.message],
          ['hint', notFoundHint(err.message, ctx.toolName)],
        ]),
        ...(hasDetails(details) ? { details } : {}),
      })
    }
    case 'forbidden': {
      return toolErrorResult(
        fieldsInOrder([
          ['code', 'forbidden'],
          ['message', err.message],
          [
            'hint',
            isNonEmptyText(ctx.role)
              ? `Your workspace role is ${ctx.role}; this may need a higher workspace or project role (members write, admins and owners manage).`
              : 'Your role does not allow this; members write, admins and owners manage.',
          ],
        ]),
      )
    }
    case 'conflict': {
      const details = err instanceof ConflictError ? err.details : undefined
      return toolErrorResult({
        ...fieldsInOrder([
          ['code', 'conflict'],
          ['message', err.message],
          ['hint', conflictHint(err.message, details)],
        ]),
        ...(hasDetails(details) ? { details } : {}),
      })
    }
    case 'payload_too_large': {
      return toolErrorResult(
        fieldsInOrder([
          ['code', 'payload_too_large'],
          ['message', err.message],
          ['hint', 'Send less data, or split it across several calls.'],
        ]),
      )
    }
    default: {
      return NO_TOOL_ERROR
    }
  }
}
