import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import type { MCPTool } from './types.ts'

type InputSchema = MCPTool['inputSchema']

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
