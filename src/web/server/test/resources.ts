import { Iterable, Predicate, Effect } from 'effect'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { handleApiBinaryRequest } from '#core/api/files.ts'
import { makeApiRateLimitHandlers } from '#core/api/rate-limit.ts'
import type { CoreEnvironment } from '#core/environment.ts'
import { handleCoreFileRequest } from '#core/files.ts'
import { makeWebCoreHandlers } from '#core/web/operations.ts'
import type { WebCoreRpcShape } from '#core/web/operations.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import type { Env } from '@/request.ts'

export type TestEnvironment = CoreEnvironment &
  Omit<Env, 'CORE'> & {
    CORE: Env['CORE'] & {
      apiCheckRateLimit: (
        ...args: Parameters<ReturnType<typeof makeApiRateLimitHandlers<never>>['apiCheckRateLimit']>
      ) => Promise<string>
    } & { [K in keyof WebCoreRpcShape]: (...args: Parameters<WebCoreRpcShape[K]>) => Promise<string> }
  }

/**
 * Unit-test storage doubles only. Worker acceptance uses actual native KV/R2 bindings.
 *
 * @returns {KVNamespace} A KV namespace with its own in-memory store.
 */
export const inMemoryKV = function inMemoryKV(): KVNamespace {
  const values = new Map<string, string>()
  return {
    get: async (key: string, options?: string | { type?: string }) => {
      const value = values.get(key) ?? null
      const type = Predicate.isString(options) ? options : options?.type
      if (Predicate.isNullish(value)) {
        return null
      }
      if (type === 'json') {
        return JSON.parse(value)
      }
      if (type === 'arrayBuffer') {
        return new TextEncoder().encode(value).buffer
      }
      if (type === 'stream') {
        return new Response(value).body
      }
      return value
    },
    getWithMetadata: async (key: string) => ({ value: values.get(key) ?? null, metadata: null, cacheStatus: null }),
    put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) => {
      const text = Predicate.isString(value) ? value : await new Response(value as BodyInit).text()
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

export const inMemoryR2 = function inMemoryR2(): R2Bucket {
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
      if (isNonEmptyText(value.httpMetadata.contentType)) {
        headers.set('content-type', value.httpMetadata.contentType)
      }
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
      if (!value) {
        return null
      }
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
      Iterable.forEach(Predicate.isString(keys) ? [keys] : keys, (key) => {
        values.delete(key)
      })
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

export const createTestResources = function createTestResources() {
  const kv = inMemoryKV()
  const oauthKv = inMemoryKV()
  const r2 = inMemoryR2()
  return { kv, oauthKv, r2, KV: kv, OAUTH_KV: oauthKv, R2: r2 }
}

// Read the complete fixture after initialization because it owns the Core binding.
const makeTestCore = function makeTestCore(readEnvironment: () => TestEnvironment): TestEnvironment['CORE'] {
  const bindWebMethod = function bindWebMethod<Args extends unknown[]>(
    select: (handlers: WebCoreRpcShape) => (...args: Args) => Effect.Effect<string>,
  ): (...args: Args) => Promise<string> {
    return async (...args: Args) => {
      const handlers = makeWebCoreHandlers(Effect.succeed(readEnvironment()))
      return runTestEffect(select(handlers)(...args))
    }
  }

  return {
    webSettingsGroups: bindWebMethod((handlers) => handlers.webSettingsGroups),
    webSettingsTokens: bindWebMethod((handlers) => handlers.webSettingsTokens),
    webSettingsConnectors: bindWebMethod((handlers) => handlers.webSettingsConnectors),
    webSettingsMcp: bindWebMethod((handlers) => handlers.webSettingsMcp),
    webCreateGroup: bindWebMethod((handlers) => handlers.webCreateGroup),
    webUpdateGroup: bindWebMethod((handlers) => handlers.webUpdateGroup),
    webDeleteGroup: bindWebMethod((handlers) => handlers.webDeleteGroup),
    webAddGroupMember: bindWebMethod((handlers) => handlers.webAddGroupMember),
    webRemoveGroupMember: bindWebMethod((handlers) => handlers.webRemoveGroupMember),
    webSetGroupGrant: bindWebMethod((handlers) => handlers.webSetGroupGrant),
    webRemoveGroupGrant: bindWebMethod((handlers) => handlers.webRemoveGroupGrant),
    webCreateToken: bindWebMethod((handlers) => handlers.webCreateToken),
    webRevokeToken: bindWebMethod((handlers) => handlers.webRevokeToken),
    webDisconnectConnector: bindWebMethod((handlers) => handlers.webDisconnectConnector),
    apiCheckRateLimit: async (
      ...args: Parameters<ReturnType<typeof makeApiRateLimitHandlers<never>>['apiCheckRateLimit']>
    ) => {
      const rateLimit = makeApiRateLimitHandlers(Effect.succeed(readEnvironment()))
      return runTestEffect(rateLimit.apiCheckRateLimit(...args))
    },
    fetch: async (request: Request) => {
      const environment = readEnvironment()
      return (await handleApiBinaryRequest(request, environment)) ?? handleCoreFileRequest(request, environment)
    },
    browserWorkspaceBrand: bindWebMethod((handlers) => handlers.browserWorkspaceBrand),
    webFeedbackIndex: bindWebMethod((handlers) => handlers.webFeedbackIndex),
    webFeedbackDetail: bindWebMethod((handlers) => handlers.webFeedbackDetail),
    webCreateFeedbackSource: bindWebMethod((handlers) => handlers.webCreateFeedbackSource),
    webUpdateFeedbackSource: bindWebMethod((handlers) => handlers.webUpdateFeedbackSource),
    webRotateFeedbackSourceToken: bindWebMethod((handlers) => handlers.webRotateFeedbackSourceToken),
    webRevokeFeedbackSource: bindWebMethod((handlers) => handlers.webRevokeFeedbackSource),
    webUpdateFeedbackStatus: bindWebMethod((handlers) => handlers.webUpdateFeedbackStatus),
    webConvertFeedback: bindWebMethod((handlers) => handlers.webConvertFeedback),
    webBulkReviewFeedback: bindWebMethod((handlers) => handlers.webBulkReviewFeedback),
    webBulkConvertFeedback: bindWebMethod((handlers) => handlers.webBulkConvertFeedback),
    webSharedIssue: bindWebMethod((handlers) => handlers.webSharedIssue),
    webWikiPage: bindWebMethod((handlers) => handlers.webWikiPage),
    webWikiDiff: bindWebMethod((handlers) => handlers.webWikiDiff),
    webWikiDraft: bindWebMethod((handlers) => handlers.webWikiDraft),
    webCreateWikiPage: bindWebMethod((handlers) => handlers.webCreateWikiPage),
    webUpdateWikiPage: bindWebMethod((handlers) => handlers.webUpdateWikiPage),
    webPublishWikiPage: bindWebMethod((handlers) => handlers.webPublishWikiPage),
    webSaveWikiDraft: bindWebMethod((handlers) => handlers.webSaveWikiDraft),
    webDiscardWikiDraft: bindWebMethod((handlers) => handlers.webDiscardWikiDraft),
    webVerifyWikiPage: bindWebMethod((handlers) => handlers.webVerifyWikiPage),
    webDeleteWikiPage: bindWebMethod((handlers) => handlers.webDeleteWikiPage),
    webUndeleteWikiPage: bindWebMethod((handlers) => handlers.webUndeleteWikiPage),
    webRestoreWikiRevision: bindWebMethod((handlers) => handlers.webRestoreWikiRevision),
    webWikiSeed: bindWebMethod((handlers) => handlers.webWikiSeed),
    webProjectCatalog: bindWebMethod((handlers) => handlers.webProjectCatalog),
    webProjectOverview: bindWebMethod((handlers) => handlers.webProjectOverview),
    webCreateProject: bindWebMethod((handlers) => handlers.webCreateProject),
    webUpdateProject: bindWebMethod((handlers) => handlers.webUpdateProject),
    webFlowMetrics: bindWebMethod((handlers) => handlers.webFlowMetrics),
    webCodeHeatmap: bindWebMethod((handlers) => handlers.webCodeHeatmap),
    webCreateSprint: bindWebMethod((handlers) => handlers.webCreateSprint),
    webDeleteSprint: bindWebMethod((handlers) => handlers.webDeleteSprint),
    webMoveSprintIssues: bindWebMethod((handlers) => handlers.webMoveSprintIssues),
    webCreateIssue: bindWebMethod((handlers) => handlers.webCreateIssue),
    webUpdateIssue: bindWebMethod((handlers) => handlers.webUpdateIssue),
    webAddComment: bindWebMethod((handlers) => handlers.webAddComment),
    webUpdateComment: bindWebMethod((handlers) => handlers.webUpdateComment),
    webDeleteComment: bindWebMethod((handlers) => handlers.webDeleteComment),
    webCreateIssueLink: bindWebMethod((handlers) => handlers.webCreateIssueLink),
    webDeleteIssueLink: bindWebMethod((handlers) => handlers.webDeleteIssueLink),
    webCreateShareToken: bindWebMethod((handlers) => handlers.webCreateShareToken),
    webCreateLinkAttachment: bindWebMethod((handlers) => handlers.webCreateLinkAttachment),
    webDeleteStoredAttachment: bindWebMethod((handlers) => handlers.webDeleteStoredAttachment),
    webSetAttachmentReviewStatus: bindWebMethod((handlers) => handlers.webSetAttachmentReviewStatus),
    webUpdateSprint: bindWebMethod((handlers) => handlers.webUpdateSprint),
    webIssue: bindWebMethod((handlers) => handlers.webIssue),
    webIssuePage: bindWebMethod((handlers) => handlers.webIssuePage),
    webIssueSearch: bindWebMethod((handlers) => handlers.webIssueSearch),
    webIssueComments: bindWebMethod((handlers) => handlers.webIssueComments),
    webIssueLinks: bindWebMethod((handlers) => handlers.webIssueLinks),
    webIssueAttachments: bindWebMethod((handlers) => handlers.webIssueAttachments),
    webWikiAttachmentSearch: bindWebMethod((handlers) => handlers.webWikiAttachmentSearch),
    webIssueLookups: bindWebMethod((handlers) => handlers.webIssueLookups),
    webIssueMembers: bindWebMethod((handlers) => handlers.webIssueMembers),
    webSprints: bindWebMethod((handlers) => handlers.webSprints),
    webSprint: bindWebMethod((handlers) => handlers.webSprint),
    browserScope: bindWebMethod((handlers) => handlers.browserScope),
  }
}

export const testEnvironment = function testEnvironment(
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
    CORE: overrides.CORE ?? makeTestCore(() => result),
  }
  return result
}
