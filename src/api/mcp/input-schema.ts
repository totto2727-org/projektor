import { Predicate } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import type { MCPTool } from './types.ts'

export { fieldsInOrder } from '#contracts/ordered-fields.ts'

type InputSchema = MCPTool['inputSchema']

export const isOmittedArgument: typeof Predicate.isUndefined = function isOmittedArgument(value) {
  // oxlint-disable-next-line rules/prefer-is-nullish -- An explicit null is a supplied MCP argument and only undefined means omitted.
  return Predicate.isUndefined(value)
}

export const objectInputSchema = function objectInputSchema(
  properties: Readonly<Record<string, unknown>>,
): InputSchema {
  return fieldsInOrder([
    ['type', 'object'],
    ['properties', properties],
  ])
}

export const requiredObjectInputSchema = function requiredObjectInputSchema(
  required: string[],
  properties: Readonly<Record<string, unknown>>,
): InputSchema {
  return fieldsInOrder([
    ['type', 'object'],
    ['required', required],
    ['properties', properties],
  ])
}

type DescribedPropertyType = 'boolean' | 'number' | 'object' | 'string'

export const describedInputProperty = function describedInputProperty(
  type: DescribedPropertyType,
  description: string,
): InputSchema {
  return fieldsInOrder([
    ['type', type],
    ['description', description],
  ])
}
