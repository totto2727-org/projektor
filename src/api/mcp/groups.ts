import {
  addGroupMember,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  listMemberGroups,
  removeGroupGrant,
  removeGroupMember,
  setGroupGrant,
  updateGroup,
} from '#api/services/groups.ts'

import { CREATE, DESTRUCTIVE, IDEMPOTENT_WRITE, PLAIN_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const groupsTools: MCPTool[] = [
  {
    annotations: READ,
    description:
      'List access groups. Owner/admin see all groups in the workspace; other members see only groups they belong to.',
    async handler(_input, ctx) {
      return listGroups(ctx)
    },
    inputSchema: objectInputSchema({}),
    name: 'list_groups',
  },
  {
    annotations: READ,
    description: 'Get an access group with its members and project grants',
    async handler(input, ctx) {
      const { id } = input as { id: string }
      return getGroup(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], { id: { type: 'string', description: 'Group ID' } }),
    name: 'get_group',
  },
  {
    annotations: READ,
    description:
      'List every workspace member with the access groups they belong to (owner/admin only). ' +
      'Members with no groups appear with an empty list — the pending/default-deny state.',
    async handler(_input, ctx) {
      return listMemberGroups(ctx)
    },
    inputSchema: objectInputSchema({}),
    name: 'list_member_groups',
  },
  {
    annotations: CREATE,
    description: 'Create an access group (owner/admin only)',
    async handler(input, ctx) {
      return await createGroup(ctx, input)
    },
    inputSchema: requiredObjectInputSchema(['name'], {
      name: { type: 'string', description: 'Group name, unique per workspace (max 100)' },
      description: { type: 'string', description: 'Optional description (max 500)' },
    }),
    name: 'create_group',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description: 'Rename an access group or change its description (owner/admin only)',
    async handler(input, ctx) {
      const { id, ...fields } = input as { id: string; [k: string]: unknown }
      return updateGroup(ctx, id, fields)
    },
    inputSchema: requiredObjectInputSchema(['id'], {
      id: { type: 'string', description: 'Group ID' },
      name: { type: 'string', description: 'New group name' },
      description: { type: 'string', description: 'New description' },
    }),
    name: 'update_group',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Delete an access group; its memberships and project grants cascade (owner/admin only)',
    async handler(input, ctx) {
      const { id } = input as { id: string }
      return deleteGroup(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], { id: { type: 'string', description: 'Group ID' } }),
    name: 'delete_group',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Add a workspace member to an access group (owner/admin only)',
    async handler(input, ctx) {
      const { groupId, ...fields } = input as { groupId: string; [k: string]: unknown }
      return addGroupMember(ctx, groupId, fields)
    },
    inputSchema: requiredObjectInputSchema(['groupId', 'userId'], {
      groupId: { type: 'string', description: 'Group ID' },
      userId: { type: 'string', description: 'User ID (must be a workspace member)' },
    }),
    name: 'add_group_member',
  },
  {
    annotations: DESTRUCTIVE,
    description: 'Remove a member from an access group (owner/admin only)',
    async handler(input, ctx) {
      const { groupId, userId } = input as { groupId: string; userId: string }
      return removeGroupMember(ctx, groupId, userId)
    },
    inputSchema: requiredObjectInputSchema(['groupId', 'userId'], {
      groupId: { type: 'string', description: 'Group ID' },
      userId: { type: 'string', description: 'User ID' },
    }),
    name: 'remove_group_member',
  },
  {
    annotations: IDEMPOTENT_WRITE,
    description:
      'Grant an access group a role on a project (upsert — changes the role if a grant already exists). Owner/admin only.',
    async handler(input, ctx) {
      const { groupId, ...fields } = input as { groupId: string; [k: string]: unknown }
      return setGroupGrant(ctx, groupId, fields)
    },
    inputSchema: requiredObjectInputSchema(['groupId', 'projectId', 'role'], {
      groupId: { type: 'string', description: 'Group ID' },
      projectId: { type: 'string', description: 'Project ID' },
      role: {
        type: 'string',
        enum: ['viewer', 'member', 'admin'],
        description: 'Role members of this group get inside the project',
      },
    }),
    name: 'set_group_grant',
  },
  {
    annotations: DESTRUCTIVE,
    description: "Remove an access group's grant on a project (owner/admin only)",
    async handler(input, ctx) {
      const { groupId, projectId } = input as { groupId: string; projectId: string }
      return removeGroupGrant(ctx, groupId, projectId)
    },
    inputSchema: requiredObjectInputSchema(['groupId', 'projectId'], {
      groupId: { type: 'string', description: 'Group ID' },
      projectId: { type: 'string', description: 'Project ID' },
    }),
    name: 'remove_group_grant',
  },
]
