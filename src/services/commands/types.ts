import type { PluginContext } from '#types'

// REST, MCP and Web commands share the same transport-independent context.
export type ServiceCtx = PluginContext
