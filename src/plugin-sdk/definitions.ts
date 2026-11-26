import type { MCPTool, Plugin } from '#types'

export const definePlugin = function definePlugin(plugin: Plugin): Plugin {
  return plugin
}

export const defineMCPTool = function defineMCPTool(tool: MCPTool): MCPTool {
  return tool
}

export type { MCPTool, Migration, Plugin, PluginContext } from '#types'
