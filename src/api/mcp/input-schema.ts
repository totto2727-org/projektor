import type { MCPTool } from './types.ts'

type InputSchema = MCPTool['inputSchema']

export const objectInputSchema = function objectInputSchema(
  properties: Readonly<Record<string, unknown>>,
): InputSchema {
  // oxlint-disable-next-line eslint/sort-keys -- tools/list preserves the existing order of the schema fields.
  return { type: 'object', properties }
}

export const requiredObjectInputSchema = function requiredObjectInputSchema(
  required: string[],
  properties: Readonly<Record<string, unknown>>,
): InputSchema {
  // oxlint-disable-next-line eslint/sort-keys -- tools/list preserves the existing order of the schema fields.
  return { type: 'object', required, properties }
}
