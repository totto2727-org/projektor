import { Effect } from 'effect'

import { handleApiBinaryRequest } from '../../../core/api/files'
import { makeApiRateLimitHandlers } from '../../../core/api/rate-limit'
import type { CoreEnvironment } from '../../../core/environment'
import { handleCoreFileRequest } from '../../../core/files'
import { makeWebCoreHandlers, type WebCoreRpcShape } from '../../../core/web/operations'
import type { WebRequest, ScopeOptions } from '../../../core/web/scope'
import type { Env } from '../../request'
export type TestEnvironment = CoreEnvironment &
  Omit<Env, 'CORE'> & {
    CORE: Env['CORE'] & {
      apiCheckRateLimit: (
        ...args: Parameters<ReturnType<typeof makeApiRateLimitHandlers<never>>['apiCheckRateLimit']>
      ) => Promise<string>
    } & { [K in keyof WebCoreRpcShape]: (...args: Parameters<WebCoreRpcShape[K]>) => Promise<string> }
  }

/** Unit-test storage doubles only. Worker acceptance uses actual native KV/R2 bindings. */
export function inMemoryKV(): KVNamespace {
  const values = new Map<string, string>()
  return {
    get: async (key: string, options?: string | { type?: string }) => {
      const value = values.get(key) ?? null
      const type = typeof options === 'string' ? options : options?.type
      if (value === null) return null
      if (type === 'json') return JSON.parse(value)
      if (type === 'arrayBuffer') return new TextEncoder().encode(value).buffer
      if (type === 'stream') return new Response(value).body
      return value
    },
    getWithMetadata: async (key: string) => ({ value: values.get(key) ?? null, metadata: null, cacheStatus: null }),
    put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) => {
      const text = typeof value === 'string' ? value : await new Response(value as BodyInit).text()
      values.set(key, text)
    },
    delete: async (key: string) => {
      values.delete(key)
    },
    list: async (options?: { prefix?: string }) => ({
      keys: [...values.keys()].filter((name) => name.startsWith(options?.prefix ?? '')).map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    }),
  } as KVNamespace
}

export function inMemoryR2(): R2Bucket {
  const values = new Map<string, { bytes: Uint8Array<ArrayBuffer>; httpMetadata: R2HTTPMetadata }>()
  const object = (key: string, value: { bytes: Uint8Array<ArrayBuffer>; httpMetadata: R2HTTPMetadata }) => ({
    key,
    size: value.bytes.byteLength,
    version: 'test',
    etag: 'test',
    httpEtag: '"test"',
    uploaded: new Date(0),
    checksums: { toJSON: () => ({}) },
    httpMetadata: value.httpMetadata,
    customMetadata: {},
    storageClass: 'Standard' as const,
    writeHttpMetadata: (headers: Headers) => {
      if (value.httpMetadata.contentType) headers.set('content-type', value.httpMetadata.contentType)
    },
  })
  return {
    createMultipartUpload: async () => {
      throw new Error('Multipart R2 uploads are not exercised by this unit fixture.')
    },
    resumeMultipartUpload: () => {
      throw new Error('Multipart R2 uploads are not exercised by this unit fixture.')
    },
    put: async (key: string, body: BodyInit | null, options?: { httpMetadata?: R2HTTPMetadata }) => {
      const value = {
        bytes: new Uint8Array(await new Response(body).arrayBuffer()),
        httpMetadata: options?.httpMetadata ?? {},
      }
      values.set(key, value)
      return object(key, value)
    },
    get: async (key: string) => {
      const value = values.get(key)
      if (!value) return null
      const response = new Response(value.bytes)
      return {
        ...object(key, value),
        body: response.body!,
        bodyUsed: false,
        arrayBuffer: () => response.arrayBuffer(),
        text: () => response.text(),
        json: () => response.json(),
        blob: () => response.blob(),
        bytes: async () => new Uint8Array(await response.arrayBuffer()),
      }
    },
    head: async (key: string) => {
      const value = values.get(key)
      return value ? object(key, value) : null
    },
    delete: async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) values.delete(key)
    },
    list: async (options?: { prefix?: string }) => ({
      objects: [...values.entries()]
        .filter(([key]) => key.startsWith(options?.prefix ?? ''))
        .map(([key, value]) => object(key, value)),
      truncated: false,
      delimitedPrefixes: [],
    }),
  } as R2Bucket
}

export function createTestResources() {
  const kv = inMemoryKV()
  const oauthKv = inMemoryKV()
  const r2 = inMemoryR2()
  return { kv, oauthKv, r2, KV: kv, OAUTH_KV: oauthKv, R2: r2 }
}

export function testEnvironment(
  db: D1Database,
  email = 'owner@example.test',
  overrides: Partial<TestEnvironment> = {},
): TestEnvironment {
  const resources = createTestResources()
  const env: Omit<TestEnvironment, 'CORE'> = {
    KV: resources.kv,
    OAUTH_KV: resources.oauthKv,
    R2: resources.r2,
    ENVIRONMENT: 'development',
    DEV_USER_EMAIL: email,
    CF_ACCESS_TEAM_DOMAIN: '',
    CF_ACCESS_AUDIENCE: '',
    ...overrides,
    DB: db,
  }
  const result: TestEnvironment = {
    ...env,
    CORE: overrides.CORE ?? {
      webSettingsGroups: (...args: Parameters<WebCoreRpcShape['webSettingsGroups']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSettingsGroups(...args)),
      webSettingsTokens: (...args: Parameters<WebCoreRpcShape['webSettingsTokens']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSettingsTokens(...args)),
      webSettingsConnectors: (...args: Parameters<WebCoreRpcShape['webSettingsConnectors']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSettingsConnectors(...args)),
      webSettingsMcp: (...args: Parameters<WebCoreRpcShape['webSettingsMcp']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSettingsMcp(...args)),
      webCreateGroup: (...args: Parameters<WebCoreRpcShape['webCreateGroup']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateGroup(...args)),
      webUpdateGroup: (...args: Parameters<WebCoreRpcShape['webUpdateGroup']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateGroup(...args)),
      webDeleteGroup: (...args: Parameters<WebCoreRpcShape['webDeleteGroup']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDeleteGroup(...args)),
      webAddGroupMember: (...args: Parameters<WebCoreRpcShape['webAddGroupMember']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webAddGroupMember(...args)),
      webRemoveGroupMember: (...args: Parameters<WebCoreRpcShape['webRemoveGroupMember']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webRemoveGroupMember(...args)),
      webSetGroupGrant: (...args: Parameters<WebCoreRpcShape['webSetGroupGrant']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSetGroupGrant(...args)),
      webRemoveGroupGrant: (...args: Parameters<WebCoreRpcShape['webRemoveGroupGrant']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webRemoveGroupGrant(...args)),
      webCreateToken: (...args: Parameters<WebCoreRpcShape['webCreateToken']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateToken(...args)),
      webRevokeToken: (...args: Parameters<WebCoreRpcShape['webRevokeToken']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webRevokeToken(...args)),
      webDisconnectConnector: (...args: Parameters<WebCoreRpcShape['webDisconnectConnector']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDisconnectConnector(...args)),
      apiCheckRateLimit: (
        ...args: Parameters<ReturnType<typeof makeApiRateLimitHandlers<never>>['apiCheckRateLimit']>
      ) => Effect.runPromise(makeApiRateLimitHandlers(Effect.succeed(result)).apiCheckRateLimit(...args)),
      fetch: async (request: Request) =>
        (await handleApiBinaryRequest(request, result)) ?? handleCoreFileRequest(request, result),
      browserWorkspaceBrand: (...args: Parameters<WebCoreRpcShape['browserWorkspaceBrand']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).browserWorkspaceBrand(...args)),
      webFeedbackIndex: (...args: Parameters<WebCoreRpcShape['webFeedbackIndex']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webFeedbackIndex(...args)),
      webFeedbackDetail: (...args: Parameters<WebCoreRpcShape['webFeedbackDetail']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webFeedbackDetail(...args)),
      webCreateFeedbackSource: (...args: Parameters<WebCoreRpcShape['webCreateFeedbackSource']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateFeedbackSource(...args)),
      webUpdateFeedbackSource: (...args: Parameters<WebCoreRpcShape['webUpdateFeedbackSource']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateFeedbackSource(...args)),
      webRotateFeedbackSourceToken: (...args: Parameters<WebCoreRpcShape['webRotateFeedbackSourceToken']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webRotateFeedbackSourceToken(...args)),
      webRevokeFeedbackSource: (...args: Parameters<WebCoreRpcShape['webRevokeFeedbackSource']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webRevokeFeedbackSource(...args)),
      webUpdateFeedbackStatus: (...args: Parameters<WebCoreRpcShape['webUpdateFeedbackStatus']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateFeedbackStatus(...args)),
      webConvertFeedback: (...args: Parameters<WebCoreRpcShape['webConvertFeedback']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webConvertFeedback(...args)),
      webBulkReviewFeedback: (...args: Parameters<WebCoreRpcShape['webBulkReviewFeedback']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webBulkReviewFeedback(...args)),
      webBulkConvertFeedback: (...args: Parameters<WebCoreRpcShape['webBulkConvertFeedback']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webBulkConvertFeedback(...args)),
      webSharedIssue: (...args: Parameters<WebCoreRpcShape['webSharedIssue']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSharedIssue(...args)),
      webWikiPage: (...args: Parameters<WebCoreRpcShape['webWikiPage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webWikiPage(...args)),
      webWikiDiff: (...args: Parameters<WebCoreRpcShape['webWikiDiff']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webWikiDiff(...args)),
      webWikiDraft: (...args: Parameters<WebCoreRpcShape['webWikiDraft']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webWikiDraft(...args)),
      webCreateWikiPage: (...args: Parameters<WebCoreRpcShape['webCreateWikiPage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateWikiPage(...args)),
      webUpdateWikiPage: (...args: Parameters<WebCoreRpcShape['webUpdateWikiPage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateWikiPage(...args)),
      webPublishWikiPage: (...args: Parameters<WebCoreRpcShape['webPublishWikiPage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webPublishWikiPage(...args)),
      webSaveWikiDraft: (...args: Parameters<WebCoreRpcShape['webSaveWikiDraft']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSaveWikiDraft(...args)),
      webDiscardWikiDraft: (...args: Parameters<WebCoreRpcShape['webDiscardWikiDraft']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDiscardWikiDraft(...args)),
      webVerifyWikiPage: (...args: Parameters<WebCoreRpcShape['webVerifyWikiPage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webVerifyWikiPage(...args)),
      webDeleteWikiPage: (...args: Parameters<WebCoreRpcShape['webDeleteWikiPage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDeleteWikiPage(...args)),
      webUndeleteWikiPage: (...args: Parameters<WebCoreRpcShape['webUndeleteWikiPage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUndeleteWikiPage(...args)),
      webRestoreWikiRevision: (...args: Parameters<WebCoreRpcShape['webRestoreWikiRevision']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webRestoreWikiRevision(...args)),
      webWikiSeed: (...args: Parameters<WebCoreRpcShape['webWikiSeed']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webWikiSeed(...args)),
      webProjectCatalog: (...args: Parameters<WebCoreRpcShape['webProjectCatalog']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webProjectCatalog(...args)),
      webProjectOverview: (...args: Parameters<WebCoreRpcShape['webProjectOverview']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webProjectOverview(...args)),
      webCreateProject: (...args: Parameters<WebCoreRpcShape['webCreateProject']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateProject(...args)),
      webUpdateProject: (...args: Parameters<WebCoreRpcShape['webUpdateProject']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateProject(...args)),
      webFlowMetrics: (...args: Parameters<WebCoreRpcShape['webFlowMetrics']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webFlowMetrics(...args)),
      webCodeHeatmap: (...args: Parameters<WebCoreRpcShape['webCodeHeatmap']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCodeHeatmap(...args)),
      webCreateSprint: (...args: Parameters<WebCoreRpcShape['webCreateSprint']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateSprint(...args)),
      webDeleteSprint: (...args: Parameters<WebCoreRpcShape['webDeleteSprint']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDeleteSprint(...args)),
      webMoveSprintIssues: (...args: Parameters<WebCoreRpcShape['webMoveSprintIssues']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webMoveSprintIssues(...args)),
      webCreateIssue: (...args: Parameters<WebCoreRpcShape['webCreateIssue']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateIssue(...args)),
      webUpdateIssue: (...args: Parameters<WebCoreRpcShape['webUpdateIssue']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateIssue(...args)),
      webAddComment: (...args: Parameters<WebCoreRpcShape['webAddComment']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webAddComment(...args)),
      webUpdateComment: (...args: Parameters<WebCoreRpcShape['webUpdateComment']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateComment(...args)),
      webDeleteComment: (...args: Parameters<WebCoreRpcShape['webDeleteComment']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDeleteComment(...args)),
      webCreateIssueLink: (...args: Parameters<WebCoreRpcShape['webCreateIssueLink']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateIssueLink(...args)),
      webDeleteIssueLink: (...args: Parameters<WebCoreRpcShape['webDeleteIssueLink']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDeleteIssueLink(...args)),
      webCreateShareToken: (...args: Parameters<WebCoreRpcShape['webCreateShareToken']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateShareToken(...args)),
      webCreateLinkAttachment: (...args: Parameters<WebCoreRpcShape['webCreateLinkAttachment']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webCreateLinkAttachment(...args)),
      webDeleteStoredAttachment: (...args: Parameters<WebCoreRpcShape['webDeleteStoredAttachment']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webDeleteStoredAttachment(...args)),
      webUpdateSprint: (...args: Parameters<WebCoreRpcShape['webUpdateSprint']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webUpdateSprint(...args)),
      webIssue: (...args: Parameters<WebCoreRpcShape['webIssue']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssue(...args)),
      webIssuePage: (...args: Parameters<WebCoreRpcShape['webIssuePage']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssuePage(...args)),
      webIssueSearch: (...args: Parameters<WebCoreRpcShape['webIssueSearch']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssueSearch(...args)),
      webIssueComments: (...args: Parameters<WebCoreRpcShape['webIssueComments']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssueComments(...args)),
      webIssueLinks: (...args: Parameters<WebCoreRpcShape['webIssueLinks']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssueLinks(...args)),
      webIssueAttachments: (...args: Parameters<WebCoreRpcShape['webIssueAttachments']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssueAttachments(...args)),
      webWikiAttachmentSearch: (...args: Parameters<WebCoreRpcShape['webWikiAttachmentSearch']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webWikiAttachmentSearch(...args)),
      webIssueLookups: (...args: Parameters<WebCoreRpcShape['webIssueLookups']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssueLookups(...args)),
      webIssueMembers: (...args: Parameters<WebCoreRpcShape['webIssueMembers']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webIssueMembers(...args)),
      webSprints: (...args: Parameters<WebCoreRpcShape['webSprints']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSprints(...args)),
      webSprint: (...args: Parameters<WebCoreRpcShape['webSprint']>) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).webSprint(...args)),
      browserScope: (request: WebRequest, options: ScopeOptions = {}) =>
        Effect.runPromise(makeWebCoreHandlers(Effect.succeed(result)).browserScope(request, options)),
    },
  }
  return result
}
