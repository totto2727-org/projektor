import { Iterable } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { agentMessagesTools } from './agent-messages.ts'
import { agentsTools } from './agents.ts'
import { codeHeatmapTools } from './code-heatmap.ts'
import { commentsTools } from './comments.ts'
import { customFieldsTools } from './custom-fields.ts'
import { feedbackTools } from './feedback.ts'
import { fileClaimsTools } from './file-claims.ts'
import { filesTools } from './files.ts'
import { flowMetricsTools } from './flow-metrics.ts'
import { groupsTools } from './groups.ts'
import { issueLeasesTools } from './issue-leases.ts'
import { issueLinksTools } from './issue-links.ts'
import { issuesTools } from './issues.ts'
import { playbooksTools } from './playbooks.ts'
import { projectActivityTools } from './project-activity.ts'
import { projectsTools } from './projects.ts'
import { sprintsTools } from './sprints.ts'
import { taskStatusesTools } from './task-statuses.ts'
import { taskTypesTools } from './task-types.ts'
import type { MCPTool } from './types.ts'
import { wikiTools } from './wiki.ts'
import { workflowTools } from './workflow.ts'
import { workspacesTools } from './workspaces.ts'

/**
 * A domain-facing grouping of the MCP tool registry.
 *
 * The runtime registry lives in routes/mcp.ts. The source-parity tests keep
 * this catalog in the same order with the same tools as runtime dispatch.
 */
export interface ToolDomain {
  /** Stable slug, e.g. "issues". */
  domain: string
  /** Human-facing heading. */
  title: string
  /** Coordination = agent-native primitives; Data = project content/config. */
  group: 'Coordination' | 'Project data'
  tools: MCPTool[]
}

type ToolDomainEntry = Readonly<[domain: string, title: string, group: ToolDomain['group'], tools: ToolDomain['tools']]>

const toolDomain = function toolDomain([domain, title, group, tools]: ToolDomainEntry): ToolDomain {
  return fieldsInOrder([
    ['domain', domain],
    ['title', title],
    ['group', group],
    ['tools', tools],
  ])
}

export const TOOL_DOMAINS: ToolDomain[] = [
  toolDomain(['workspaces', 'Workspaces & members', 'Project data', workspacesTools]),
  toolDomain(['groups', 'Groups & access', 'Project data', groupsTools]),
  toolDomain(['projects', 'Projects', 'Project data', projectsTools]),
  toolDomain(['project-activity', 'Project activity', 'Project data', projectActivityTools]),
  toolDomain(['issues', 'Issues', 'Project data', issuesTools]),
  toolDomain(['issue-links', 'Issue links', 'Project data', issueLinksTools]),
  toolDomain(['comments', 'Comments', 'Project data', commentsTools]),
  toolDomain(['wiki', 'Wiki', 'Project data', wikiTools]),
  toolDomain(['files', 'Attachments', 'Project data', filesTools]),
  toolDomain(['task-types', 'Task types', 'Project data', taskTypesTools]),
  toolDomain(['task-statuses', 'Task statuses', 'Project data', taskStatusesTools]),
  toolDomain(['custom-fields', 'Custom fields', 'Project data', customFieldsTools]),
  toolDomain(['sprints', 'Sprints', 'Project data', sprintsTools]),
  toolDomain(['feedback', 'Feedback', 'Project data', feedbackTools]),
  toolDomain(['agents', 'Agent sessions', 'Coordination', agentsTools]),
  toolDomain(['file-claims', 'File claims', 'Coordination', fileClaimsTools]),
  toolDomain(['issue-leases', 'Issue leases', 'Coordination', issueLeasesTools]),
  toolDomain(['agent-messages', 'Agent messages', 'Coordination', agentMessagesTools]),
  toolDomain(['workflow', 'Workflow spec', 'Coordination', workflowTools]),
  toolDomain(['playbooks', 'Playbooks', 'Coordination', playbooksTools]),
  toolDomain(['flow-metrics', 'Flow metrics', 'Project data', flowMetricsTools]),
  toolDomain(['code-heatmap', 'Code heatmap', 'Project data', codeHeatmapTools]),
]

/** Total number of MCP tools across all domains. */
export const TOOL_COUNT = TOOL_DOMAINS.reduce((total, domain) => total + domain.tools.length, 0)

/** Valid `?domains=` slugs, in catalog order — the fail-closed validation list. */
export const TOOL_DOMAIN_SLUGS: string[] = TOOL_DOMAINS.map((domain) => domain.domain)

/** Tool names belonging to the given domain slugs. Unknown slugs are silently ignored — callers validate against `TOOL_DOMAIN_SLUGS` first. */
export const toolNamesForDomains = function toolNamesForDomains(slugs: Iterable<string>): Set<string> {
  const wanted = new Set(slugs)
  const names = new Set<string>()
  Iterable.forEach(TOOL_DOMAINS, (domain): void => {
    if (wanted.has(domain.domain)) {
      Iterable.forEach(domain.tools, (tool): void => {
        names.add(tool.name)
      })
    }
  })
  return names
}
