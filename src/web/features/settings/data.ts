import { coreResult } from '@/core.ts'
import type { CoreResult } from '@/core.ts'
import type { BrowserCommandClient } from '@/server/browser-command.ts'

import { CreatedGroupSchema, NewTokenSchema, SettingsOkSchema } from './schemas.ts'

export const groupCommands = {
  createGroup: (ctx: BrowserCommandClient, input: unknown): CoreResult<typeof CreatedGroupSchema.Type> =>
    coreResult(CreatedGroupSchema, ctx.core.webCreateGroup(ctx.proof, input)),
  updateGroup: (ctx: BrowserCommandClient, groupId: string, input: unknown): CoreResult<typeof SettingsOkSchema.Type> =>
    coreResult(SettingsOkSchema, ctx.core.webUpdateGroup(ctx.proof, groupId, input)),
  deleteGroup: (ctx: BrowserCommandClient, groupId: string): CoreResult<typeof SettingsOkSchema.Type> =>
    coreResult(SettingsOkSchema, ctx.core.webDeleteGroup(ctx.proof, groupId)),
  addGroupMember: (
    ctx: BrowserCommandClient,
    groupId: string,
    input: unknown,
  ): CoreResult<typeof SettingsOkSchema.Type> =>
    coreResult(SettingsOkSchema, ctx.core.webAddGroupMember(ctx.proof, groupId, input)),
  removeGroupMember: (
    ctx: BrowserCommandClient,
    groupId: string,
    userId: string,
  ): CoreResult<typeof SettingsOkSchema.Type> =>
    coreResult(SettingsOkSchema, ctx.core.webRemoveGroupMember(ctx.proof, groupId, userId)),
  setGroupGrant: (
    ctx: BrowserCommandClient,
    groupId: string,
    input: { projectId: string; role: 'viewer' | 'member' | 'admin' },
  ): CoreResult<typeof SettingsOkSchema.Type> =>
    coreResult(SettingsOkSchema, ctx.core.webSetGroupGrant(ctx.proof, groupId, input.projectId, input.role)),
  removeGroupGrant: (
    ctx: BrowserCommandClient,
    groupId: string,
    projectId: string,
  ): CoreResult<typeof SettingsOkSchema.Type> =>
    coreResult(SettingsOkSchema, ctx.core.webRemoveGroupGrant(ctx.proof, groupId, projectId)),
}
export const workspaceCommands = {
  createToken: (ctx: BrowserCommandClient, input: unknown): CoreResult<typeof NewTokenSchema.Type> =>
    coreResult(NewTokenSchema, ctx.core.webCreateToken(ctx.proof, input)),
  revokeToken: (ctx: BrowserCommandClient, tokenId: string): CoreResult<typeof SettingsOkSchema.Type> =>
    coreResult(SettingsOkSchema, ctx.core.webRevokeToken(ctx.proof, tokenId)),
}
export const revokeConnectorGrant = (
  ctx: BrowserCommandClient,
  connectorId: string,
): CoreResult<typeof SettingsOkSchema.Type> =>
  coreResult(SettingsOkSchema, ctx.core.webDisconnectConnector(ctx.proof, connectorId))
