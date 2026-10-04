export type GrantRole = "viewer" | "member" | "admin";
export interface GroupSummary {
	id: string;
	name: string;
	description: string | null;
	memberCount: number;
	grantCount: number;
}
export interface GroupMember {
	userId: string;
	email: string;
	name: string;
}
export interface GroupGrant {
	projectId: string;
	projectName: string;
	projectKey: string;
	role: GrantRole;
}
export interface GroupDetail extends GroupSummary {
	members: GroupMember[];
	grants: GroupGrant[];
}
export interface WorkspaceMember {
	id: string;
	email: string;
	name: string;
	role: string;
}
export interface MemberGroupsRow {
	userId: string;
	groups: { id: string; name: string }[];
}
export interface ProjectLite {
	id: string;
	name: string;
	key: string;
	workspace_slug: string;
}
export interface GroupData {
	groups: GroupSummary[];
	details: GroupDetail[];
	members: WorkspaceMember[];
	memberGroups: MemberGroupsRow[];
	projects: ProjectLite[];
	role: string;
}
export interface Token {
	id: string;
	name: string;
	scopes: string;
	lastUsedAt: number | null;
	expiresAt: number | null;
	createdAt: number;
}
/** Token creation deliberately has a different wire shape than the list DTO. */
export interface NewTokenResult {
	id: string;
	token: string;
	name: string;
	scopes: string[];
	expiresAt: number | null;
}
export interface ConnectorGrant {
	id: string;
	client: string;
	clientId: string;
	scopes: string[];
	grantedAt: number;
	expiresAt: number;
}
export interface McpInfo {
	mcpUrl: string;
	mcpAddCommandTemplate: string | null;
}
