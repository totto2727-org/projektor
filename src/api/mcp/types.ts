import type { ApiServiceCtx } from '#api/services/types.ts'
import type { MCPTool as DomainMcpTool } from '#types'

/** External MCP handlers shape protocol data and invoke named Core operations. */
export interface MCPTool extends Omit<DomainMcpTool, 'handler'> {
  handler: (input: unknown, ctx: ApiServiceCtx) => Promise<unknown>
}

export type PluginContext = ApiServiceCtx
