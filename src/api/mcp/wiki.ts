import type { MCPTool } from './types.ts'
import { wikiEditTools } from './wiki-edit-tools.ts'
import { wikiLifecycleTools } from './wiki-lifecycle-tools.ts'
import { wikiMaintenanceTools } from './wiki-maintenance-tools.ts'
import { wikiReadTools } from './wiki-read-tools.ts'
import { wikiWatchTools } from './wiki-watch-tools.ts'

export const wikiTools: MCPTool[] = [
  ...wikiReadTools,
  ...wikiEditTools,
  ...wikiMaintenanceTools,
  ...wikiWatchTools,
  ...wikiLifecycleTools,
]
