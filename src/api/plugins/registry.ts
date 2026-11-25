import type { MCPTool } from '#api/mcp/types.ts'
import type { Plugin as DomainPlugin } from '#types'

type Plugin = Omit<DomainPlugin, 'mcpTools'> & { mcpTools?: MCPTool[] }

class PluginRegistry {
  private plugins = new Map<string, Plugin>()
  // Workspace IDs map to sets of plugin IDs
  private workspacePlugins = new Map<string, Set<string>>()

  public register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin)
  }

  public enableForWorkspace(workspaceId: string, pluginId: string): void {
    const set = this.workspacePlugins.get(workspaceId) ?? new Set()
    set.add(pluginId)
    this.workspacePlugins.set(workspaceId, set)
  }

  public getToolsForWorkspace(workspaceId: string): MCPTool[] {
    const ids = this.workspacePlugins.get(workspaceId) ?? new Set()
    return [...ids].flatMap((id) => this.plugins.get(id)?.mcpTools ?? [])
  }

  public getAll(): Plugin[] {
    return [...this.plugins.values()]
  }
}

export const pluginRegistry = new PluginRegistry()
