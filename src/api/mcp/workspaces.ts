import { flattenError } from 'zod'

import { apiReply } from '#api/services/reply.ts'
import {
  deleteWorkspace,
  getWorkspaceBrand,
  getWorkspaceWithMembers,
  inviteMember,
  removeMember,
  updateMemberRole,
  updateWorkspace,
  updateWorkspaceBrand,
} from '#api/services/workspaces.ts'
import { ApiWorkspace } from '#contracts/api-auth.ts'
import { ApiResults } from '#contracts/api-results.ts'
import { ValidationError } from '#contracts/errors.ts'
import { DeleteWorkspaceInput } from '#contracts/inputs/workspaces.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, PLAIN_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema } from './input-schema.ts'
import type { MCPTool, PluginContext } from './types.ts'

const currentWorkspace = async function currentWorkspace(ctx: PluginContext) {
  return apiReply(ApiWorkspace, ctx.core.apiResolveWorkspace(ctx.actor, { kind: 'id', value: ctx.workspaceId }))
}

const currentWorkspaceSlug = async function currentWorkspaceSlug(ctx: PluginContext): Promise<string> {
  const result = await currentWorkspace(ctx)
  return result.slug
}

export const workspacesTools: MCPTool[] = [
  {
    name: 'list_workspaces',
    description: 'List all workspaces the authenticated user belongs to, with their role in each',
    inputSchema: objectInputSchema({}),
    annotations: READ,
    async handler(_input, ctx) {
      return apiReply(ApiResults.apiListWorkspaces, ctx.core.apiListWorkspaces(ctx.actor))
    },
  },
  {
    name: 'create_workspace',
    description:
      'Create a new workspace and add the caller as owner. Seeds default task types, statuses, and custom fields.',
    inputSchema: requiredObjectInputSchema(['slug', 'name'], {
      slug: {
        type: 'string',
        description: 'URL-safe identifier for the workspace (e.g. "my-team")',
      },
      name: { type: 'string', description: 'Human-readable display name for the workspace' },
    }),
    annotations: CREATE,
    async handler(input, ctx) {
      return apiReply(ApiResults.apiCreateWorkspace, ctx.core.apiCreateWorkspace(ctx.actor, input))
    },
  },
  {
    name: 'delete_workspace',
    description:
      'Permanently delete a workspace. Owner-only. The default workspace cannot be deleted. ' +
      'All projects must be removed first.',
    inputSchema: requiredObjectInputSchema(['workspaceSlug'], {
      workspaceSlug: {
        type: 'string',
        description: 'Slug of the workspace to delete',
      },
    }),
    annotations: DESTRUCTIVE,
    async handler(input, ctx) {
      const parsed = DeleteWorkspaceInput.safeParse(input)
      if (!parsed.success) {
        throw new ValidationError(flattenError(parsed.error))
      }
      const { workspaceSlug } = parsed.data

      /*
       * PROJ-884: only the workspace named in the MCP URL (ctx.workspaceId, set by
       * middleware) can be deleted. Never retarget ctx at a slug-resolved workspace —
       * ctx.role and token confinement belong to the URL's workspace, not the target.
       * deleteWorkspace 404s when workspaceSlug isn't ctx's workspace.
       */
      return await deleteWorkspace(ctx, workspaceSlug, 'projektor')
    },
  },
  {
    name: 'update_workspace',
    description: 'Rename the current workspace. Admin+ only.',
    inputSchema: requiredObjectInputSchema(['name'], {
      name: { type: 'string', description: 'New display name for the workspace' },
    }),
    annotations: IDEMPOTENT_WRITE,
    async handler(input, ctx) {
      return await updateWorkspace(ctx, input)
    },
  },
  {
    name: 'list_members',
    description: 'List all members of the current workspace with their roles',
    inputSchema: objectInputSchema({}),
    annotations: READ,
    async handler(_input, ctx) {
      const ws = await currentWorkspace(ctx)
      const result = await getWorkspaceWithMembers(ctx, ws)
      return result.members
    },
  },
  {
    name: 'invite_member',
    description:
      'Invite a user to the workspace by email. Admin+ only. Creates the user record if they do not exist yet.',
    inputSchema: requiredObjectInputSchema(['email', 'role'], {
      email: { type: 'string', description: 'Email address of the user to invite' },
      role: {
        type: 'string',
        enum: ['owner', 'admin', 'member', 'viewer'],
        description: 'Role to assign to the invited user',
      },
    }),
    annotations: PLAIN_WRITE,
    async handler(input, ctx) {
      return inviteMember(ctx, input)
    },
  },
  {
    name: 'remove_member',
    description: 'Remove a member from the workspace. Owner only. Cannot remove yourself.',
    inputSchema: requiredObjectInputSchema(['userId'], {
      userId: { type: 'string', description: 'ID of the user to remove' },
    }),
    annotations: DESTRUCTIVE,
    async handler(input, ctx) {
      const { userId } = input as { userId: string }
      return removeMember(ctx, userId)
    },
  },
  {
    name: 'update_member_role',
    description: "Change a workspace member's role. Owner only.",
    inputSchema: requiredObjectInputSchema(['userId', 'role'], {
      userId: { type: 'string', description: 'ID of the user whose role to change' },
      role: {
        type: 'string',
        enum: ['owner', 'admin', 'member', 'viewer'],
        description: 'New role to assign',
      },
    }),
    annotations: DESTRUCTIVE,
    async handler(input, ctx) {
      const { userId, role } = input as { userId: string; role: string }
      return updateMemberRole(ctx, userId, { role })
    },
  },
  {
    name: 'get_workspace_brand',
    description:
      "Get the current workspace's white-label branding overrides (display name, accent colors, logo, font). Unset fields are null.",
    inputSchema: objectInputSchema({}),
    annotations: READ,
    async handler(_input, ctx) {
      return getWorkspaceBrand(ctx, await currentWorkspaceSlug(ctx))
    },
  },
  {
    name: 'update_workspace_brand',
    description:
      "Update the current workspace's white-label branding overrides. Admin+ only. Pass a field as null to clear it back to the deploy-level default; omit a field to leave it unchanged.",
    inputSchema: objectInputSchema({
      displayName: { type: ['string', 'null'], description: 'Workspace display name override' },
      accent: {
        type: ['string', 'null'],
        description: 'Accent color as a hex string, e.g. #ff8800',
      },
      onAccent: {
        type: ['string', 'null'],
        description: 'Text/icon color to use on top of the accent color, as a hex string',
      },
      fontFamily: { type: ['string', 'null'], description: 'CSS font-family override' },
      fontUrl: {
        type: ['string', 'null'],
        description: 'URL of a stylesheet defining fontFamily',
      },
    }),
    annotations: IDEMPOTENT_WRITE,
    async handler(input, ctx) {
      return updateWorkspaceBrand(ctx, await currentWorkspaceSlug(ctx), input)
    },
  },
]
