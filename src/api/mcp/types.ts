import type { MCPTool as DomainMcpTool } from '#types'

import type { ApiServiceCtx } from '../services/types'

/** External MCP handlers shape protocol data and invoke named Core operations. */
export interface MCPTool extends Omit<DomainMcpTool, 'handler'> {
  handler: (input: unknown, ctx: ApiServiceCtx) => Promise<unknown>
}

export type PluginContext = ApiServiceCtx
