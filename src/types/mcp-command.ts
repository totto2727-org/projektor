export interface McpAddCommandParts {
  workspaceSlug: string
  mcpUrl: string
  token: string
}

export const buildMcpAddCommand = function buildMcpAddCommand({
  workspaceSlug,
  mcpUrl,
  token,
}: McpAddCommandParts): string {
  return (
    `claude mcp add --transport http ` +
    `--header "Authorization: Bearer ${token}" ` +
    `--header "X-Workspace-Slug: ${workspaceSlug}" ` +
    `projektor "${mcpUrl}"`
  )
}

export const buildMcpAddCommandMultiline = function buildMcpAddCommandMultiline({
  workspaceSlug,
  mcpUrl,
  token,
}: McpAddCommandParts): string {
  return [
    `claude mcp add --transport http \\`,
    `  --header "Authorization: Bearer ${token}" \\`,
    `  --header "X-Workspace-Slug: ${workspaceSlug}" \\`,
    `  projektor "${mcpUrl}"`,
  ].join('\n')
}
