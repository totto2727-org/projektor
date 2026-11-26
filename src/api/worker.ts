import { String, Predicate, Schema } from 'effect'
import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { makeCoreClient } from 'projektor/core-client'
import { CorePublicError } from 'projektor/core-client'

import { apiReply } from '#api/services/reply.ts'
import { ApiDevelopmentBootstrap } from '#contracts/api-auth.ts'
import { ApiResults } from '#contracts/api-results.ts'
import { ServiceError } from '#contracts/errors.ts'
import { HTTP_CREATED, HTTP_INTERNAL_SERVER_ERROR, HTTP_MOVED_PERMANENTLY } from '#contracts/http-status.ts'
import { safeDecodeURIComponent } from '#contracts/urls.ts'
import type { ApiEnv, HonoEnv } from '#types'

import { jsonBody } from './http/body.ts'
import { serviceErrToResponse } from './http/error-adapter.ts'
import { injectWikiMetadata, resolveWikiPageForSsr } from './lib/wiki-ssr.ts'
import { authMiddleware } from './middleware/auth.ts'
import { etagMiddleware } from './middleware/etag.ts'
import { rateLimitMiddleware } from './middleware/rate-limit.ts'
import { workspaceMiddleware } from './middleware/workspace.ts'
import {
  createOAuthProvider,
  isOAuthAccessToken,
  isOAuthProviderPath,
  // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
  oauthProviderRateLimited,
} from './oauth/provider.ts'
import { agentMessagesRouter } from './routes/agent-messages.ts'
import { agentsRouter } from './routes/agents.ts'
import { authRouter } from './routes/auth.ts'
import { codeHeatmapRouter } from './routes/code-heatmap.ts'
import { commentsRouter } from './routes/comments.ts'
import { configRouter } from './routes/config.ts'
import { customFieldsRouter } from './routes/custom-fields.ts'
import { feedbackSourceLookupRouter, feedbackSourcesRouter } from './routes/feedback-sources.ts'
import { feedbackPublicRouter, feedbackRouter } from './routes/feedback.ts'
import { fileClaimsRouter } from './routes/file-claims.ts'
import { filesRouter } from './routes/files.ts'
import { flowMetricsRouter } from './routes/flow-metrics.ts'
import { groupsRouter } from './routes/groups.ts'
import { issueLeasesRouter } from './routes/issue-leases.ts'
import { issueLinksRouter } from './routes/issue-links.ts'
import { issuesRouter } from './routes/issues.ts'
import { mcpRouter } from './routes/mcp.ts'
import { oauthMetadataRouter } from './routes/oauth-metadata.ts'
import { oauthRouter } from './routes/oauth.ts'
import { playbooksRouter } from './routes/playbooks.ts'
import { projectActivityRouter } from './routes/project-activity.ts'
import { projectsRouter } from './routes/projects.ts'
import { realtimeRouter } from './routes/realtime.ts'
import { shareIssuesRouter, sharePublicRouter } from './routes/share.ts'
import { sprintsRouter } from './routes/sprints.ts'
import { taskStatusesRouter } from './routes/task-statuses.ts'
import { taskTypesRouter } from './routes/task-types.ts'
import { wikiRouter } from './routes/wiki.ts'
import { workflowRouter } from './routes/workflow.ts'
import { workspacesRouter } from './routes/workspaces.ts'

const app = new Hono<HonoEnv>()
app.onError((error, httpContext) => {
  if (error instanceof CorePublicError || error instanceof ServiceError) {
    return serviceErrToResponse(httpContext, error)
  }
  console.error('unhandled error', { method: httpContext.req.method, path: httpContext.req.path, error })
  return httpContext.json({ error: 'Internal Server Error' }, HTTP_INTERNAL_SERVER_ERROR)
})

// Anonymous ingestion owns its source-specific CORS, before the global allowlist.
app.route('/api/feedback', feedbackPublicRouter)
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: (origin, httpContext) => {
      const allowed = ((httpContext.env as ApiEnv).CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      return allowed.includes(origin) ? origin : null
    },
    allowHeaders: ['Authorization', 'Content-Type', 'Cf-Access-Jwt-Assertion', 'X-Workspace-Slug'],
  }),
)
app.get('/health', (httpContext) => httpContext.json({ ok: true }))
app.get('/api/health', (httpContext) => httpContext.json({ ok: true }))
app.route('/api/config', configRouter)
app.use('/api/*', rateLimitMiddleware)
app.use('/mcp/*', rateLimitMiddleware)
app.use('/.well-known/*', rateLimitMiddleware)
app.route('/.well-known', oauthMetadataRouter)
app.use('/oauth/*', rateLimitMiddleware)
app.use('/oauth/*', authMiddleware)
app.route('/oauth', oauthRouter)

app.get('/bootstrap', async (httpContext) => {
  try {
    const result = await apiReply(
      ApiDevelopmentBootstrap,
      makeCoreClient(httpContext.env.CORE).apiBootstrap(
        httpContext.req.header('X-Bootstrap-Secret') ?? httpContext.req.query('setup_secret'),
        httpContext.req.url,
      ),
    )
    return httpContext.json(result)
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
app.route('/api/share', sharePublicRouter)
app.route('/auth', authRouter)
app.get('/api/workspaces', authMiddleware, async (httpContext) => {
  const result = await apiReply(
    ApiResults.apiListWorkspaces,
    makeCoreClient(httpContext.env.CORE).apiListWorkspaces(httpContext.get('coreActor')),
  )
  return httpContext.json(result)
})
app.post('/api/workspaces', authMiddleware, async (httpContext) => {
  try {
    const result = await apiReply(
      ApiResults.apiCreateWorkspace,
      makeCoreClient(httpContext.env.CORE).apiCreateWorkspace(
        httpContext.get('coreActor'),
        await jsonBody(httpContext),
      ),
    )
    return httpContext.json(result, HTTP_CREATED)
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
app.use('/api/workspaces/:slug/*', authMiddleware, workspaceMiddleware)
app.get('/api/projects', authMiddleware, etagMiddleware, async (httpContext) => {
  try {
    const result = await apiReply(
      ApiResults.apiListProjects,
      makeCoreClient(httpContext.env.CORE).apiListProjects(
        httpContext.get('coreActor'),
        httpContext.req.query('includeArchived') === 'true',
      ),
    )
    return httpContext.json(result)
  } catch (error) {
    return serviceErrToResponse(httpContext, error)
  }
})
app.use('/api/projects/*', authMiddleware, workspaceMiddleware)
app.use('/api/issues/*', authMiddleware, workspaceMiddleware)
app.use('/api/issue-links/*', authMiddleware, workspaceMiddleware)
app.use('/api/wiki/*', authMiddleware, workspaceMiddleware)
app.use('/mcp/*', authMiddleware, workspaceMiddleware)
const allowFilesQueryWorkspaceFallback = async (httpContext: Context<HonoEnv>, next: Next): Promise<void> => {
  if (httpContext.req.method === 'GET') {
    httpContext.set('allowQueryWorkspaceFallback', true)
  }
  await next()
}
app.use('/api/files/*', allowFilesQueryWorkspaceFallback)
app.use('/api/files/*', authMiddleware, workspaceMiddleware)
app.use('/api/task-types/*', authMiddleware, workspaceMiddleware)
app.use('/api/task-statuses/*', authMiddleware, workspaceMiddleware)
app.use('/api/custom-fields/*', authMiddleware, workspaceMiddleware)
app.use('/api/sprints/*', authMiddleware, workspaceMiddleware)
app.use('/api/agents/*', authMiddleware, workspaceMiddleware)
app.use('/api/file-claims/*', authMiddleware, workspaceMiddleware)
app.use('/api/issue-leases/*', authMiddleware, workspaceMiddleware)
app.use('/api/agent-messages/*', authMiddleware, workspaceMiddleware)
app.use('/api/feedback-sources/*', authMiddleware, workspaceMiddleware)
app.use('/api/workflow/*', authMiddleware)
app.use('/api/playbooks/*', authMiddleware)
app.use('/api/playbooks/:name/compose', workspaceMiddleware)
// Conditional responses follow authorization, never before it.
app.use('/api/issues/*', etagMiddleware)
app.use('/api/task-statuses', etagMiddleware)
app.route('/api/workspaces', workspacesRouter)
app.route('/api/workspaces', groupsRouter)
app.route('/api/projects', projectsRouter)
app.route('/api/projects', flowMetricsRouter)
app.route('/api/projects', codeHeatmapRouter)
app.route('/api/projects', projectActivityRouter)
app.route('/api/projects', feedbackSourcesRouter)
app.route('/api/feedback-sources', feedbackSourceLookupRouter)
app.route('/api/projects', feedbackRouter)
app.route('/api/issues', issuesRouter)
app.route('/api/issues', issueLinksRouter)
app.route('/api/issues', commentsRouter)
app.route('/api/issues', shareIssuesRouter)
app.route('/api/wiki', wikiRouter)
app.route('/mcp', mcpRouter)
app.route('/api/files', filesRouter)
app.route('/api/task-types', taskTypesRouter)
app.route('/api/task-statuses', taskStatusesRouter)
app.route('/api/custom-fields', customFieldsRouter)
app.route('/api/sprints', sprintsRouter)
app.route('/api/agents', agentsRouter)
app.route('/api/file-claims', fileClaimsRouter)
app.route('/api/issue-leases', issueLeasesRouter)
app.route('/api/agent-messages', agentMessagesRouter)
app.route('/api/workflow', workflowRouter)
app.route('/api/playbooks', playbooksRouter)
app.route('/api', realtimeRouter)

app.get('/wiki', async (httpContext) => {
  const assets = httpContext.env.ASSETS
  if (!assets) {
    return httpContext.notFound()
  }
  const slug = httpContext.req.query('slug')
  const shell = (): Promise<Response> => assets.fetch(new Request(new URL('/wiki/index.html', httpContext.req.url)))
  if (Predicate.isNullish(slug) || String.isEmpty(slug)) {
    return shell()
  }
  const page = await resolveWikiPageForSsr(httpContext, slug)
  return page ? httpContext.redirect(page.url, HTTP_MOVED_PERMANENTLY) : shell()
})
const fallbackAssetPath = function fallbackAssetPath(pathname: string, wikiSlugMatch: RegExpExecArray | null): string {
  if (/^\/projects\/[^/]+\/issues\/\d+\//u.test(pathname)) {
    return '/issues/view/index.html'
  }
  if (/^\/projects\/view\/[^/]+/u.test(pathname)) {
    return '/projects/view/index.html'
  }
  if (pathname.startsWith('/share/')) {
    return '/share/view/index.html'
  }
  if (/^\/feedback\/[^/]+/u.test(pathname)) {
    return '/feedback/view/index.html'
  }
  return wikiSlugMatch ? '/wiki/view/index.html' : '/index.html'
}

app.get('*', async (httpContext) => {
  if (!httpContext.env.ASSETS) {
    return httpContext.notFound()
  }
  const { pathname } = new URL(httpContext.req.url)
  const wikiSlugMatch = /^\/wiki\/([^/]+)\/?$/u.exec(pathname)
  const fallbackPath = fallbackAssetPath(pathname, wikiSlugMatch)
  const response = await httpContext.env.ASSETS.fetch(new Request(new URL(fallbackPath, httpContext.req.url)))
  if (wikiSlugMatch) {
    const slug = safeDecodeURIComponent(wikiSlugMatch[1])
    const page =
      Predicate.isNotNullish(slug) && String.isNonEmpty(slug) ? await resolveWikiPageForSsr(httpContext, slug) : null
    if (page) {
      return injectWikiMetadata(response, page, new URL(pathname, httpContext.req.url).toString())
    }
  }
  return response
})

/** The physical cron remains API-owned, with persistent maintenance inside Core. */
export const scheduled = async function scheduled(
  _controller: ScheduledController,
  env: ApiEnv,
  ctx: ExecutionContext,
): Promise<void> {
  ctx.waitUntil(apiReply(Schema.Null, makeCoreClient(env.CORE).apiMaintenance()))
}

/*
 * Only provider-shaped OAuth credentials enter the provider. Browser Access,
 * opaque tokens, development identity, and public viewer retain their precedence.
 */
const oauthProvider = createOAuthProvider(app)
// oxlint-disable-next-line import/no-default-export -- Cloudflare Workers loads the API fetch and scheduled handlers from the default export.
export default {
  async fetch(request: Request, env: ApiEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (isOAuthProviderPath(pathname)) {
      // TODO: Orca lacks CIMD, so DCR is temporary. Restore the pre-fix code once Orca supports CIMD.
      const limited = await oauthProviderRateLimited(request, env)
      return limited ?? oauthProvider.fetch(request, env, ctx)
    }
    if (isOAuthAccessToken(request)) {
      return oauthProvider.fetch(request, env, ctx)
    }
    return app.fetch(request, env, ctx)
  },
  scheduled,
} satisfies ExportedHandler<ApiEnv>

export { RateLimiter } from './lib/rate-limiter-do.ts'
export { WorkspaceHub } from './realtime/workspace-hub.ts'
