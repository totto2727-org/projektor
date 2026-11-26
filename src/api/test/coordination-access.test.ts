import { describe, expect, test } from 'vite-plus/test'

import { currentEpochSeconds } from '#contracts/time.ts'

import { env } from './fixture-api.ts'
import { authHeaders, seedAgentLease, seedGroupGrant, seedIssue, seedProject, seedWorkspaceRoles } from './helpers.ts'
import { fetchNativeApi } from './native-fetch.ts'
import { RecordItemsResponse, parseNativeMcpText, RpcTextResponse, readNativeJson } from './response-json.ts'

/*
 * PROJ-316: the fleet-coordination list surfaces (issue-leases, file-claims,
 * agents) must respect the same default-deny project visibility as issues — a
 * non-admin member with no grant on a project must not be able to enumerate its
 * issue IDs, file paths, or agent activity. Owner/admin bypass groups.
 */

interface ListResult {
  items: Record<string, unknown>[]
}

const lexicalCompare = function lexicalCompare(leftValue: unknown, rightValue: unknown): number {
  const left = String(leftValue)
  const right = String(rightValue)
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

const mcpList = async function mcpList(
  tool: string,
  token: string,
  slug: string,
  workspaceId: string,
): Promise<ListResult> {
  const res = await fetchNativeApi(`http://localhost/mcp/${workspaceId}`, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: tool, arguments: {} },
    }),
    headers: authHeaders(token, slug),
    method: 'POST',
  })
  const body = await readNativeJson(res, RpcTextResponse)
  return parseNativeMcpText(body.result.content[0].text, RecordItemsResponse)
}

const seedFileClaim = async function seedFileClaim(workspaceId: string, issueId: string, path: string): Promise<void> {
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO issue_file_claims (id, workspace_id, issue_id, agent_id, path, claimed_at, released_at)
		 VALUES (?, ?, ?, NULL, ?, ?, NULL)`,
  )
    .bind(crypto.randomUUID(), workspaceId, issueId, path, now)
    .run()
}

const seedFloatingAgent = async function seedFloatingAgent(workspaceId: string, name: string): Promise<string> {
  const id = crypto.randomUUID()
  const now = currentEpochSeconds()
  await env.DB.prepare(
    `INSERT INTO agent_sessions
		   (id, workspace_id, issue_id, token_id, name, kind, status, started_at, last_heartbeat_at, ended_at)
		 VALUES (?, ?, NULL, NULL, ?, 'agent', 'active', ?, ?, NULL)`,
  )
    .bind(id, workspaceId, name, now, now)
    .run()
  return id
}

describe('covers PROJ-316 coordination data respects project visibility', () => {
  type TestData = Readonly<{
    issueA: string
    issueB: string
    slug: string
    ws: Awaited<ReturnType<typeof seedWorkspaceRoles>>
  }>

  const seedTestData = async function seedTestData(): Promise<TestData> {
    const ws = await seedWorkspaceRoles()
    const { slug } = ws.workspace
    const projectA = await seedProject(ws.workspace.id, 'AAA')
    const projectB = await seedProject(ws.workspace.id, 'BBB')
    // The member can see project A only.
    await seedGroupGrant(ws.workspace.id, ws.member.user.id, projectA.id, 'member')

    const issueAResult = await seedIssue(ws.workspace.id, projectA.id, ws.owner.user.id, { title: 'A' })
    const issueA = issueAResult.id
    const issueBResult = await seedIssue(ws.workspace.id, projectB.id, ws.owner.user.id, { title: 'B' })
    const issueB = issueBResult.id

    /*
     * A live lease + agent on each issue, a file claim on each, and one agent
     * pinned to no issue (workspace-level coordination).
     */
    await seedAgentLease(ws.workspace.id, issueA, { name: 'agent-A' })
    await seedAgentLease(ws.workspace.id, issueB, { name: 'agent-B' })
    await seedFileClaim(ws.workspace.id, issueA, 'a/only.ts')
    await seedFileClaim(ws.workspace.id, issueB, 'b/secret.ts')
    await seedFloatingAgent(ws.workspace.id, 'floating')
    return { issueA, issueB, slug, ws }
  }

  test('owner sees leases/claims/agents across every project', async () => {
    const { issueA, issueB, slug, ws } = await seedTestData()
    const { token } = ws.owner
    const leases = await mcpList('list_issue_leases', token, slug, ws.workspace.id)
    expect(leases.items.map((item) => item.issueId).toSorted(lexicalCompare)).toStrictEqual(
      [issueA, issueB].toSorted(lexicalCompare),
    )

    const claims = await mcpList('list_file_claims', token, slug, ws.workspace.id)
    expect(claims.items.map((item) => item.path).toSorted(lexicalCompare)).toStrictEqual(['a/only.ts', 'b/secret.ts'])

    const agents = await mcpList('list_active_agents', token, slug, ws.workspace.id)
    expect(agents.items.map((item) => item.name).toSorted(lexicalCompare)).toStrictEqual([
      'agent-A',
      'agent-B',
      'floating',
    ])
  })

  test("a member sees only the granted project's leases and file claims", async () => {
    const { issueA, slug, ws } = await seedTestData()
    const { token } = ws.member
    const leases = await mcpList('list_issue_leases', token, slug, ws.workspace.id)
    expect(leases.items.map((item) => item.issueId)).toStrictEqual([issueA])

    const claims = await mcpList('list_file_claims', token, slug, ws.workspace.id)
    expect(claims.items.map((item) => item.path)).toStrictEqual(['a/only.ts'])
  })

  test('a member sees agents on granted projects plus issue-less agents, never hidden-project agents', async () => {
    const { slug, ws } = await seedTestData()
    const agents = await mcpList('list_active_agents', ws.member.token, slug, ws.workspace.id)
    const names = agents.items.map((item) => item.name).toSorted(lexicalCompare)
    expect(names).toStrictEqual(['agent-A', 'floating'])
    expect(names).not.toContain('agent-B')
  })

  test("a member with no grants at all sees none of another project's coordination data", async () => {
    const { slug, ws } = await seedTestData()
    // Viewer has no group grant
    const { token } = ws.viewer
    const leases = await mcpList('list_issue_leases', token, slug, ws.workspace.id)
    expect(leases.items).toHaveLength(0)
    const claims = await mcpList('list_file_claims', token, slug, ws.workspace.id)
    expect(claims.items).toHaveLength(0)
    const agents = await mcpList('list_active_agents', token, slug, ws.workspace.id)
    // Only the issue-less floating agent leaks nothing about a hidden project
    expect(agents.items.map((item) => item.name)).toStrictEqual(['floating'])
  })
})
