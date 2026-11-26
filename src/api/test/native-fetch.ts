import { exports as workerExports } from 'cloudflare:workers'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import type { FieldEntries } from '#contracts/ordered-fields.ts'

export const fetchNativeApi: Fetcher['fetch'] = (request, init) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The native test project sets api.worker.ts as its main entrypoint.
  const { default: api } = workerExports as { default: Fetcher }
  return api.fetch(request, init)
}

export const requestOptionsWithBody = function requestOptionsWithBody(
  method: RequestInit['method'],
  headers: RequestInit['headers'],
  body: RequestInit['body'],
): RequestInit {
  return { body, headers, method }
}

export const stringifyOrderedFields = function stringifyOrderedFields(fields: FieldEntries): string {
  return JSON.stringify(fieldsInOrder(fields))
}

export interface McpToolRequest {
  arguments: unknown
  name: string
}

export const fetchNativeMcpTool = async function fetchNativeMcpTool(
  workspaceId: string,
  params: McpToolRequest,
  headers: Record<string, string>,
): Promise<Response> {
  const body = JSON.stringify({
    id: 1,
    jsonrpc: '2.0',
    method: 'tools/call',
    params,
  })
  return fetchNativeApi(`http://localhost/mcp/${workspaceId}`, requestOptionsWithBody('POST', headers, body))
}
