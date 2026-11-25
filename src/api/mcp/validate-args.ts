/*
 * PROJ-920: validate MCP tool arguments against the tool's JSON `inputSchema` before the
 * handler runs, so a wrongly-typed argument is a -32602 naming the field — never a handler
 * that trips over `input as {...}` and surfaces as -32000 / 500.
 *
 * This covers the JSON Schema subset the hand-written tool schemas actually use: type
 * (string/number/integer/boolean/object/array, or a list of them), nullable, enum,
 * properties/required (recursively), items, min/maxLength, minimum/maximum and
 * min/maxItems. Any other keyword is ignored rather than guessed at. Properties a schema
 * doesn't declare are left alone: services still validate with their Zod schemas, which
 * remain the source of truth for business rules (PROJ-895 will generate these schemas
 * from them).
 *
 * Deliberately lenient where the services already are, so this never rejects a call that
 * used to work: numeric strings pass for number/integer (the Zod schemas use z.coerce),
 * "true"/"1"/"false"/"0"/"" pass for boolean (BooleanQueryParam), and null passes for any optional
 * property (Zod's .nullable().optional() "clear this field" idiom). Everything else that
 * doesn't match the declared type is rejected.
 */

import { Array, Iterable, Predicate } from 'effect'
type Schema = Record<string, unknown>

export interface ArgIssue {
  path: string
  message: string
}

const typeOf = function typeOf(v: unknown): string {
  if (v === null) {
    return 'null'
  }
  if (globalThis.Array.isArray(v)) {
    return 'array'
  }
  return typeof v
}

// Mirrors BooleanQueryParam (schemas/common.ts).
const BOOLEAN_STRINGS = new Set(['true', '1', 'false', '0', ''])

const isNumericString = function isNumericString(v: unknown): boolean {
  return Predicate.isString(v) && /^-?\d+(?:\.\d+)?$/u.test(v.trim())
}

const matchesType = function matchesType(v: unknown, t: string): boolean {
  switch (t) {
    case 'boolean': {
      return Predicate.isBoolean(v) || BOOLEAN_STRINGS.has(v as string)
    }
    case 'string':
    case 'object':
    case 'array': {
      return typeOf(v) === t
    }
    case 'number': {
      return (Predicate.isNumber(v) && Number.isFinite(v)) || isNumericString(v)
    }
    case 'integer': {
      return (Predicate.isNumber(v) && Number.isInteger(v)) || (isNumericString(v) && Number.isInteger(Number(v)))
    }
    case 'null': {
      return v === null
    }
    default: {
      // Unknown type keyword: don't reject on a guess
      return true
    }
  }
}

const validate = function validate(value: unknown, schema: Schema, path: string, issues: ArgIssue[]): void {
  if (value === null && schema.nullable === true) {
    return
  }

  const declared = schema.type
  const types = globalThis.Array.isArray(declared)
    ? declared.filter((t): t is string => Predicate.isString(t))
    : Predicate.isString(declared)
      ? [declared]
      : []
  if (Array.isArrayNonEmpty(types) && !types.some((type) => matchesType(value, type))) {
    issues.push({ path, message: `must be ${types.join(' or ')}, got ${typeOf(value)}` })
    return
  }

  if (globalThis.Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    issues.push({
      path,
      message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`,
    })
    return
  }

  if (Predicate.isString(value)) {
    if (Predicate.isNumber(schema.minLength) && value.length < schema.minLength) {
      issues.push({ path, message: `must be at least ${schema.minLength} characters` })
    }
    if (Predicate.isNumber(schema.maxLength) && value.length > schema.maxLength) {
      issues.push({ path, message: `must be at most ${schema.maxLength} characters` })
    }
  }

  if (Predicate.isNumber(value) || isNumericString(value)) {
    const n = Number(value)
    if (Predicate.isNumber(schema.minimum) && n < schema.minimum) {
      issues.push({ path, message: `must be >= ${schema.minimum}` })
    }
    if (Predicate.isNumber(schema.maximum) && n > schema.maximum) {
      issues.push({ path, message: `must be <= ${schema.maximum}` })
    }
  }

  if (globalThis.Array.isArray(value)) {
    if (Predicate.isNumber(schema.minItems) && value.length < schema.minItems) {
      issues.push({ path, message: `must have at least ${schema.minItems} items` })
    }
    if (Predicate.isNumber(schema.maxItems) && value.length > schema.maxItems) {
      issues.push({ path, message: `must have at most ${schema.maxItems} items` })
    }
    const { items } = schema
    if (Predicate.isObject(items)) {
      value.forEach((item, index) => {
        validate(item, items, `${path}[${index}]`, issues)
      })
    }
  }

  if (typeOf(value) === 'object') {
    validateObject(value as Record<string, unknown>, schema, path, issues)
  }
}

function validateObject(obj: Record<string, unknown>, schema: Schema, path: string, issues: ArgIssue[]): void {
  const props =
    schema.properties && typeof schema.properties === 'object' ? (schema.properties as Record<string, Schema>) : {}
  const prefix = path ? `${path}.` : ''
  if (globalThis.Array.isArray(schema.required)) {
    Iterable.forEach(schema.required, (key) => {
      if (Predicate.isString(key) && obj[key] === undefined) {
        issues.push({ path: `${prefix}${key}`, message: 'is required' })
      }
    })
  }
  const required = new Set(globalThis.Array.isArray(schema.required) ? schema.required : [])
  Iterable.forEach(Object.entries(props), ([key, sub]) => {
    const v = obj[key]
    if (v === undefined || !Predicate.isObjectOrArray(sub)) {
      return
    }
    if (Predicate.isNullish(v) && !required.has(key)) {
      // Optional field cleared
      return
    }
    validate(v, sub, `${prefix}${key}`, issues)
  })
}

/** Validate a tool call's `arguments` object against the tool's inputSchema. */
export const validateToolArgs = function validateToolArgs(
  inputSchema: Schema,
  args: Record<string, unknown>,
): ArgIssue[] {
  const issues: ArgIssue[] = []
  validateObject(args, inputSchema, '', issues)
  return issues
}
