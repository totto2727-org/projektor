import { Effect } from 'effect'

import * as messages from '#commands/agent-messages'
import * as agents from '#commands/agents'
import * as heatmap from '#commands/code-heatmap'
import * as comments from '#commands/comments'
import * as fields from '#commands/custom-fields'
import * as feedback from '#commands/feedback'
import * as sources from '#commands/feedback-sources'
import * as claims from '#commands/file-claims'
import * as files from '#commands/files'
import * as metrics from '#commands/flow-metrics'
import * as groups from '#commands/groups'
import * as leases from '#commands/issue-leases'
import * as links from '#commands/issue-links'
import * as issues from '#commands/issues'
import * as oauth from '#commands/oauth'
import * as compose from '#commands/playbook-compose'
import * as playbooks from '#commands/playbooks'
import * as activity from '#commands/project-activity'
import * as projects from '#commands/projects'
import * as share from '#commands/share'
import * as sprints from '#commands/sprints'
import * as statuses from '#commands/task-statuses'
import * as types from '#commands/task-types'
import type { ServiceCtx } from '#commands/types'
import * as wiki from '#commands/wiki'
import * as drafts from '#commands/wiki-drafts'
import * as wikiLinks from '#commands/wiki-links'
import * as watchers from '#commands/wiki-watchers'
import * as workflow from '#commands/workflow'
import * as workspaces from '#commands/workspaces'

import { ApiResults } from '../../contracts/api-results'
import { oauthApi } from '../../contracts/oauth-provider'
import { type CoreActor, requireCoreCapability, resolveCorePrincipal, resolveCoreServiceCtx } from '../authorization'
import { coreFailure, coreReply } from '../contract'
import { publicDomainFailure } from '../domain-errors'
import type { CoreEnvironment } from '../environment'

/** Closed, named native methods. No caller-supplied operation or capability is accepted. */
export function makeApiDomainHandlers<R>(envSource: Effect.Effect<CoreEnvironment, never, R>) {
  function operation<Args extends unknown[], A>(
    name: keyof typeof ApiResults,
    capability: 'read' | 'write',
    command: (ctx: ServiceCtx, ...args: Args) => A | Promise<A>,
    interactive = false,
  ) {
    return (actor: CoreActor, workspaceId: string, ...args: Args) =>
      coreReply(
        name,
        ApiResults[name],
        Effect.flatMap(envSource, (env) =>
          Effect.tryPromise({
            try: async () => {
              const ctx = await resolveCoreServiceCtx(actor, workspaceId, capability, env)
              if (interactive) requireInteractive(ctx)
              return command(ctx, ...args)
            },
            catch: publicDomainFailure,
          }),
        ),
      )
  }

  function connectors<Args extends unknown[], A>(
    name: 'apiListConnectorGrants' | 'apiRevokeConnectorGrant',
    capability: 'read' | 'write',
    command: (env: CoreEnvironment, ctx: ServiceCtx, ...args: Args) => Promise<A>,
  ) {
    return (actor: CoreActor, workspaceId: string, ...args: Args) =>
      coreReply(
        name,
        ApiResults[name],
        Effect.flatMap(envSource, (env) =>
          Effect.tryPromise({
            try: async () => {
              const ctx = await resolveCoreServiceCtx(actor, workspaceId, capability, env)
              requireInteractive(ctx)
              return command(env, ctx, ...args)
            },
            catch: publicDomainFailure,
          }),
        ),
      )
  }

  function globalRead<Args extends unknown[], A>(
    name: 'apiListPlaybooks' | 'apiGetPlaybook' | 'apiGetWorkflow',
    command: (...args: Args) => A | Promise<A>,
  ) {
    return (actor: CoreActor, ...args: Args) =>
      coreReply(
        name,
        ApiResults[name],
        Effect.flatMap(envSource, (env) =>
          Effect.tryPromise({
            try: async () => {
              const principal = await resolveCorePrincipal(actor, env)
              requireCoreCapability(principal, 'read')
              return command(...args)
            },
            catch: publicDomainFailure,
          }),
        ),
      )
  }

  return {
    apiRegisterAgent: operation('apiRegisterAgent', 'write', agents.registerAgent),
    apiStartWork: operation('apiStartWork', 'write', agents.startWork),
    apiHeartbeatAgent: operation('apiHeartbeatAgent', 'write', agents.heartbeatAgent),
    apiEndAgent: operation('apiEndAgent', 'write', agents.endAgent),
    apiFinishWork: operation('apiFinishWork', 'write', agents.finishWork),
    apiListActiveAgents: operation('apiListActiveAgents', 'read', agents.listActiveAgents),
    apiPostMessage: operation('apiPostMessage', 'write', messages.postMessage),
    apiListMessages: operation('apiListMessages', 'read', messages.listMessages),
    apiGetCodeHeatmap: operation('apiGetCodeHeatmap', 'read', heatmap.getCodeHeatmap),
    apiListComments: operation('apiListComments', 'read', comments.listComments),
    apiAddComment: operation('apiAddComment', 'write', comments.addComment),
    apiUpdateComment: operation('apiUpdateComment', 'write', comments.updateComment),
    apiDeleteComment: operation('apiDeleteComment', 'write', comments.deleteComment),
    apiListCustomFieldDefs: operation('apiListCustomFieldDefs', 'read', fields.listCustomFieldDefs),
    apiCreateCustomFieldDef: operation('apiCreateCustomFieldDef', 'write', fields.createCustomFieldDef),
    apiUpdateCustomFieldDef: operation('apiUpdateCustomFieldDef', 'write', fields.updateCustomFieldDef),
    apiDeleteCustomFieldDef: operation('apiDeleteCustomFieldDef', 'write', fields.deleteCustomFieldDef),
    apiListFeedback: operation('apiListFeedback', 'read', feedback.listFeedback),
    apiUpdateFeedbackStatus: operation('apiUpdateFeedbackStatus', 'write', feedback.updateFeedbackStatus),
    apiConvertFeedbackToIssue: operation('apiConvertFeedbackToIssue', 'write', feedback.convertFeedbackToIssue),
    apiBulkMarkReviewed: operation('apiBulkMarkReviewed', 'write', feedback.bulkMarkReviewed),
    apiBulkConvertToIssue: operation('apiBulkConvertToIssue', 'write', feedback.bulkConvertToIssue),
    apiGetFeedbackSummary: operation('apiGetFeedbackSummary', 'read', feedback.getFeedbackSummary),
    apiCreateFeedbackSource: operation('apiCreateFeedbackSource', 'write', sources.createFeedbackSource),
    apiListFeedbackSources: operation('apiListFeedbackSources', 'read', sources.listFeedbackSources),
    apiGetFeedbackSource: operation('apiGetFeedbackSource', 'read', sources.getFeedbackSource),
    apiUpdateFeedbackSource: operation('apiUpdateFeedbackSource', 'write', sources.updateFeedbackSource),
    apiRotateFeedbackSourceToken: operation('apiRotateFeedbackSourceToken', 'write', sources.rotateFeedbackSourceToken),
    apiRevokeFeedbackSource: operation('apiRevokeFeedbackSource', 'write', sources.revokeFeedbackSource),
    apiClaimFiles: operation('apiClaimFiles', 'write', claims.claimFiles),
    apiReleaseFiles: operation('apiReleaseFiles', 'write', claims.releaseFiles),
    apiListFileClaims: operation('apiListFileClaims', 'read', claims.listFileClaims),
    apiListAttachments: operation('apiListAttachments', 'read', files.listAttachments),
    apiCreateLinkAttachment: operation('apiCreateLinkAttachment', 'write', files.createLinkAttachment),
    apiGetAttachment: operation('apiGetAttachment', 'read', files.getAttachment),
    apiDeleteAttachment: operation('apiDeleteAttachment', 'write', files.deleteAttachment),
    apiGetFlowMetrics: operation('apiGetFlowMetrics', 'read', metrics.getFlowMetrics),
    apiListGroups: operation('apiListGroups', 'read', groups.listGroups),
    apiGetGroup: operation('apiGetGroup', 'read', groups.getGroup),
    apiListMemberGroups: operation('apiListMemberGroups', 'read', groups.listMemberGroups),
    apiCreateGroup: operation('apiCreateGroup', 'write', groups.createGroup),
    apiUpdateGroup: operation('apiUpdateGroup', 'write', groups.updateGroup),
    apiDeleteGroup: operation('apiDeleteGroup', 'write', groups.deleteGroup),
    apiAddGroupMember: operation('apiAddGroupMember', 'write', groups.addGroupMember),
    apiRemoveGroupMember: operation('apiRemoveGroupMember', 'write', groups.removeGroupMember),
    apiSetGroupGrant: operation('apiSetGroupGrant', 'write', groups.setGroupGrant),
    apiRemoveGroupGrant: operation('apiRemoveGroupGrant', 'write', groups.removeGroupGrant),
    apiClaimIssue: operation('apiClaimIssue', 'write', leases.claimIssue),
    apiReleaseIssue: operation('apiReleaseIssue', 'write', leases.releaseIssue),
    apiListIssueLeases: operation('apiListIssueLeases', 'read', leases.listIssueLeases),
    apiCreateLink: operation('apiCreateLink', 'write', links.createLink),
    apiDeleteLink: operation('apiDeleteLink', 'write', links.deleteLink),
    apiListLinksForIssue: operation('apiListLinksForIssue', 'read', links.listLinksForIssue),
    apiListIssues: operation('apiListIssues', 'read', issues.listIssues),
    apiResolveIssueIdParam: operation('apiResolveIssueIdParam', 'read', issues.resolveIssueIdParam),
    apiGetIssue: operation('apiGetIssue', 'read', issues.getIssue),
    apiGetIssuesBatch: operation('apiGetIssuesBatch', 'read', issues.getIssuesBatch),
    apiCreateIssue: operation('apiCreateIssue', 'write', issues.createIssue),
    apiUpdateIssue: operation('apiUpdateIssue', 'write', issues.updateIssue),
    apiDeleteIssue: operation('apiDeleteIssue', 'write', issues.deleteIssue),
    apiGetPrioritizedIssues: operation('apiGetPrioritizedIssues', 'read', issues.getPrioritizedIssues),
    apiSearchIssues: operation('apiSearchIssues', 'read', issues.searchIssues),
    apiComposePlaybook: operation('apiComposePlaybook', 'read', compose.composePlaybook),
    apiListPlaybooks: globalRead('apiListPlaybooks', playbooks.listPlaybooks),
    apiGetPlaybook: globalRead('apiGetPlaybook', playbooks.getPlaybook),
    apiGetWorkflow: globalRead('apiGetWorkflow', workflow.getWorkflow),
    apiListProjectActivity: operation('apiListProjectActivity', 'read', activity.listProjectActivity),
    apiListProjectsInWorkspace: operation('apiListProjectsInWorkspace', 'read', projects.listProjects),
    apiGetProject: operation('apiGetProject', 'read', projects.getProject),
    apiGetProjectBySlug: operation('apiGetProjectBySlug', 'read', projects.getProjectBySlug),
    apiResolveProjectIdParam: operation('apiResolveProjectIdParam', 'read', projects.resolveProjectIdParam),
    apiResolveVisibleProjectIdParam: operation(
      'apiResolveVisibleProjectIdParam',
      'read',
      projects.resolveVisibleProjectIdParam,
    ),
    apiCreateProject: operation('apiCreateProject', 'write', projects.createProject),
    apiUpdateProject: operation('apiUpdateProject', 'write', projects.updateProject),
    apiDeleteProject: operation('apiDeleteProject', 'write', projects.deleteProject),
    apiCreateShareToken: operation('apiCreateShareToken', 'write', share.createShareToken),
    apiRevokeShareToken: operation('apiRevokeShareToken', 'write', share.revokeShareToken),
    apiListSprints: operation('apiListSprints', 'read', sprints.listSprints),
    apiGetSprint: operation('apiGetSprint', 'read', sprints.getSprint),
    apiCreateSprint: operation('apiCreateSprint', 'write', sprints.createSprint),
    apiUpdateSprint: operation('apiUpdateSprint', 'write', sprints.updateSprint),
    apiCompleteSprint: operation('apiCompleteSprint', 'write', sprints.completeSprint),
    apiDeleteSprint: operation('apiDeleteSprint', 'write', sprints.deleteSprint),
    apiMoveIssuesToSprint: operation('apiMoveIssuesToSprint', 'write', sprints.moveIssuesToSprint),
    apiListTaskStatuses: operation('apiListTaskStatuses', 'read', statuses.listTaskStatuses),
    apiCreateTaskStatus: operation('apiCreateTaskStatus', 'write', statuses.createTaskStatus),
    apiUpdateTaskStatus: operation('apiUpdateTaskStatus', 'write', statuses.updateTaskStatus),
    apiDeleteTaskStatus: operation('apiDeleteTaskStatus', 'write', statuses.deleteTaskStatus),
    apiListTaskTypes: operation('apiListTaskTypes', 'read', types.listTaskTypes),
    apiCreateTaskType: operation('apiCreateTaskType', 'write', types.createTaskType),
    apiUpdateTaskType: operation('apiUpdateTaskType', 'write', types.updateTaskType),
    apiDeleteTaskType: operation('apiDeleteTaskType', 'write', types.deleteTaskType),
    apiListWikiPages: operation('apiListWikiPages', 'read', wiki.listWikiPages),
    apiSearchWiki: operation('apiSearchWiki', 'read', wiki.searchWiki),
    apiGetWikiPage: operation('apiGetWikiPage', 'read', wiki.getWikiPage),
    apiGetWikiBacklinks: operation('apiGetWikiBacklinks', 'read', wiki.getWikiBacklinks),
    apiListBrokenWikiLinks: operation('apiListBrokenWikiLinks', 'read', wikiLinks.listBrokenWikiLinks),
    apiBackfillWikiLinks: operation('apiBackfillWikiLinks', 'write', wikiLinks.backfillWikiLinks),
    apiPurgeExpiredWikiPages: operation('apiPurgeExpiredWikiPages', 'write', wiki.purgeExpiredWikiPages),
    apiCreateWikiPage: operation('apiCreateWikiPage', 'write', wiki.createWikiPage),
    apiUpdateWikiPage: operation('apiUpdateWikiPage', 'write', wiki.updateWikiPage),
    apiVerifyWikiPage: operation('apiVerifyWikiPage', 'write', wiki.verifyWikiPage),
    apiListStaleWikiPages: operation('apiListStaleWikiPages', 'read', wiki.listStaleWikiPages),
    apiPatchWikiPage: operation('apiPatchWikiPage', 'write', wiki.patchWikiPage),
    apiListWikiTemplates: operation('apiListWikiTemplates', 'read', wiki.listWikiTemplates),
    apiDeleteWikiPage: operation('apiDeleteWikiPage', 'write', wiki.deleteWikiPage),
    apiUndeleteWikiPage: operation('apiUndeleteWikiPage', 'write', wiki.undeleteWikiPage),
    apiListWikiTrash: operation('apiListWikiTrash', 'read', wiki.listWikiTrash),
    apiGetWikiTree: operation('apiGetWikiTree', 'read', wiki.getWikiTree),
    apiListWikiRevisions: operation('apiListWikiRevisions', 'read', wiki.listWikiRevisions),
    apiGetWikiRevision: operation('apiGetWikiRevision', 'read', wiki.getWikiRevision),
    apiGetWikiRevisionDiff: operation('apiGetWikiRevisionDiff', 'read', wiki.getWikiRevisionDiff),
    apiGetWikiDraft: operation('apiGetWikiDraft', 'read', drafts.getWikiDraft),
    apiSaveWikiDraft: operation('apiSaveWikiDraft', 'write', drafts.saveWikiDraft),
    apiDiscardWikiDraft: operation('apiDiscardWikiDraft', 'write', drafts.discardWikiDraft),
    apiWatchWikiPage: operation('apiWatchWikiPage', 'write', watchers.watchWikiPage),
    apiUnwatchWikiPage: operation('apiUnwatchWikiPage', 'write', watchers.unwatchWikiPage),
    apiListWikiWatches: operation('apiListWikiWatches', 'read', watchers.listWikiWatches),
    apiListWikiNotifications: operation('apiListWikiNotifications', 'read', watchers.listWikiNotifications),
    apiMarkWikiNotificationsRead: operation(
      'apiMarkWikiNotificationsRead',
      'write',
      watchers.markWikiNotificationsRead,
    ),
    apiListWikiChanges: operation('apiListWikiChanges', 'read', watchers.listWikiChanges),
    apiGetWorkspaceWithMembers: operation('apiGetWorkspaceWithMembers', 'read', workspaces.getWorkspaceWithMembers),
    apiUpdateWorkspace: operation('apiUpdateWorkspace', 'write', workspaces.updateWorkspace),
    apiInviteMember: operation('apiInviteMember', 'write', workspaces.inviteMember),
    apiRemoveMember: operation('apiRemoveMember', 'write', workspaces.removeMember),
    apiUpdateMemberRole: operation('apiUpdateMemberRole', 'write', workspaces.updateMemberRole),
    apiListTokens: operation('apiListTokens', 'read', workspaces.listTokens),
    apiCreateToken: operation('apiCreateToken', 'write', workspaces.createToken, true),
    apiRevokeToken: operation('apiRevokeToken', 'write', workspaces.revokeToken, true),
    apiListConnectorGrants: connectors('apiListConnectorGrants', 'read', (env, ctx) =>
      oauth.listConnectorGrants(oauthApi(env), ctx.userId, ctx.workspaceId),
    ),
    apiRevokeConnectorGrant: connectors('apiRevokeConnectorGrant', 'write', (env, ctx, grantId: string) =>
      oauth.revokeConnectorGrant(oauthApi(env), ctx.userId, ctx.workspaceId, grantId),
    ),
    apiDeleteWorkspace: operation('apiDeleteWorkspace', 'write', workspaces.deleteWorkspace),
    apiGetWorkspaceMcpInfo: operation('apiGetWorkspaceMcpInfo', 'read', workspaces.getWorkspaceMcpInfo),
    apiGetWorkspaceBrand: operation('apiGetWorkspaceBrand', 'read', workspaces.getWorkspaceBrand),
    apiUpdateWorkspaceBrand: operation('apiUpdateWorkspaceBrand', 'write', workspaces.updateWorkspaceBrand),
    apiDeleteWorkspaceLogo: operation('apiDeleteWorkspaceLogo', 'write', workspaces.deleteWorkspaceLogo),
  }
}

function requireInteractive(ctx: ServiceCtx) {
  if (ctx.auth?.kind !== 'human' || (ctx.auth.method !== 'access' && ctx.auth.method !== 'dev')) {
    throw coreFailure(403, 'Personal credentials require a signed-in browser session')
  }
}
