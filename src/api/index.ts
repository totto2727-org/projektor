import { Effect, Schema } from 'effect'
import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { decodeCoreReply, makeCoreClient } from 'projektor/core-client'

import type { ApiEnv, HonoEnv } from '#types'

import { ApiDevelopmentBootstrap } from '../contracts/api-auth'
import { ApiResults } from '../contracts/api-results'
import { ServiceError } from '../contracts/errors'
import { safeDecodeURIComponent } from '../contracts/urls'
import { CorePublicError } from '../core/contract'
import { jsonBody } from './http/body'
import { serviceErrToResponse } from './http/error-adapter'
import { injectWikiMetadata, resolveWikiPageForSsr } from './lib/wiki-ssr'
import { authMiddleware } from './middleware/auth'
import { etagMiddleware } from './middleware/etag'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { workspaceMiddleware } from './middleware/workspace'
import {
  createOAuthProvider,
  isOAuthAccessToken,
  isOAuthProviderPath,
  tokenEndpointRateLimited,
} from './oauth/provider'
import { agentMessagesRouter } from './routes/agent-messages'
import { agentsRouter } from './routes/agents'
import { authRouter } from './routes/auth'
import { codeHeatmapRouter } from './routes/code-heatmap'
import { commentsRouter } from './routes/comments'
import { configRouter } from './routes/config'
import { customFieldsRouter } from './routes/custom-fields'
import { feedbackPublicRouter, feedbackRouter } from './routes/feedback'
import { feedbackSourceLookupRouter, feedbackSourcesRouter } from './routes/feedback-sources'
import { fileClaimsRouter } from './routes/file-claims'
import { filesRouter } from './routes/files'
import { flowMetricsRouter } from './routes/flow-metrics'
import { groupsRouter } from './routes/groups'
import { issueLeasesRouter } from './routes/issue-leases'
import { issueLinksRouter } from './routes/issue-links'
import { issuesRouter } from './routes/issues'
import { mcpRouter } from './routes/mcp'
import { oauthRouter } from './routes/oauth'
import { oauthMetadataRouter } from './routes/oauth-metadata'
import { playbooksRouter } from './routes/playbooks'
import { projectActivityRouter } from './routes/project-activity'
import { projectsRouter } from './routes/projects'
import { realtimeRouter } from './routes/realtime'
import { shareIssuesRouter, sharePublicRouter } from './routes/share'
import { sprintsRouter } from './routes/sprints'
import { taskStatusesRouter } from './routes/task-statuses'
import { taskTypesRouter } from './routes/task-types'
import { wikiRouter } from './routes/wiki'
import { workflowRouter } from './routes/workflow'
import { workspacesRouter } from './routes/workspaces'

const app = new Hono<HonoEnv>()
app.onError((error, c) => {
  if (error instanceof CorePublicError || error instanceof ServiceError) return serviceErrToResponse(c, error)
  console.error('unhandled error', { method: c.req.method, path: c.req.path, error })
  return c.json({ error: 'Internal Server Error' }, 500)
})

// Anonymous ingestion owns its source-specific CORS, before the global allowlist.
app.route('/api/feedback', feedbackPublicRouter)
app.use('*', logger())
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = ((c.env as ApiEnv).CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      return allowed.includes(origin) ? origin : null
    },
    allowHeaders: ['Authorization', 'Content-Type', 'Cf-Access-Jwt-Assertion', 'X-Workspace-Slug'],
  }),
)
app.get('/health', (c) => c.json({ ok: true }))
app.get('/api/health', (c) => c.json({ ok: true }))
app.route('/api/config', configRouter)
app.use('/api/*', rateLimitMiddleware)
app.use('/mcp/*', rateLimitMiddleware)
app.use('/.well-known/*', rateLimitMiddleware)
app.route('/.well-known', oauthMetadataRouter)
app.use('/oauth/*', rateLimitMiddleware)
app.use('/oauth/*', authMiddleware)
app.route('/oauth', oauthRouter)

app.get('/bootstrap', async (c) => {
  try {
    const result = await Effect.runPromise(
      decodeCoreReply(
        ApiDevelopmentBootstrap,
        makeCoreClient(c.env.CORE).apiBootstrap(
          c.req.header('X-Bootstrap-Secret') ?? c.req.query('setup_secret'),
          c.req.url,
        ),
      ),
    )
    return c.json(result)
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
app.route('/api/share', sharePublicRouter)
app.route('/auth', authRouter)
app.get('/api/workspaces', authMiddleware, async (c) => {
  const result = await Effect.runPromise(
    decodeCoreReply(ApiResults.apiListWorkspaces, makeCoreClient(c.env.CORE).apiListWorkspaces(c.get('coreActor'))),
  )
  return c.json(result)
})
app.post('/api/workspaces', authMiddleware, async (c) => {
  try {
    const result = await Effect.runPromise(
      decodeCoreReply(
        ApiResults.apiCreateWorkspace,
        makeCoreClient(c.env.CORE).apiCreateWorkspace(c.get('coreActor'), await jsonBody(c)),
      ),
    )
    return c.json(result, 201)
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
app.use('/api/workspaces/:slug/*', authMiddleware, workspaceMiddleware)
app.get('/api/projects', authMiddleware, etagMiddleware, async (c) => {
  try {
    const result = await Effect.runPromise(
      decodeCoreReply(
        ApiResults.apiListProjects,
        makeCoreClient(c.env.CORE).apiListProjects(c.get('coreActor'), c.req.query('includeArchived') === 'true'),
      ),
    )
    return c.json(result)
  } catch (error) {
    return serviceErrToResponse(c, error)
  }
})
app.use('/api/projects/*', authMiddleware, workspaceMiddleware)
app.use('/api/issues/*', authMiddleware, workspaceMiddleware)
app.use('/api/issue-links/*', authMiddleware, workspaceMiddleware)
app.use('/api/wiki/*', authMiddleware, workspaceMiddleware)
app.use('/mcp/*', authMiddleware, workspaceMiddleware)
const allowFilesQueryWorkspaceFallback = async (c: Context<HonoEnv>, next: Next) => {
  if (c.req.method === 'GET') c.set('allowQueryWorkspaceFallback', true)
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

app.get('/wiki', async (c) => {
  const assets = c.env.ASSETS
  if (!assets) return c.notFound()
  const slug = c.req.query('slug')
  const shell = () => assets.fetch(new Request(new URL('/wiki/index.html', c.req.url)))
  if (!slug) return shell()
  const page = await resolveWikiPageForSsr(c, slug)
  return page ? c.redirect(page.url, 301) : shell()
})
app.get('*', async (c) => {
  if (!c.env.ASSETS) return c.notFound()
  const { pathname } = new URL(c.req.url)
  const wikiSlugMatch = /^\/wiki\/([^/]+)\/?$/.exec(pathname)
  const fallbackPath = /^\/projects\/[^/]+\/issues\/\d+\//.test(pathname)
    ? '/issues/view/index.html'
    : /^\/projects\/view\/[^/]+/.test(pathname)
      ? '/projects/view/index.html'
      : pathname.startsWith('/share/')
        ? '/share/view/index.html'
        : /^\/feedback\/[^/]+/.test(pathname)
          ? '/feedback/view/index.html'
          : wikiSlugMatch
            ? '/wiki/view/index.html'
            : '/index.html'
  const response = await c.env.ASSETS.fetch(new Request(new URL(fallbackPath, c.req.url)))
  if (wikiSlugMatch) {
    const slug = safeDecodeURIComponent(wikiSlugMatch[1])
    const page = slug ? await resolveWikiPageForSsr(c, slug) : null
    if (page) return injectWikiMetadata(response, page, new URL(pathname, c.req.url).toString())
  }
  return response
})

/** The physical cron remains API-owned, with persistent maintenance inside Core. */
export async function scheduled(_controller: ScheduledController, env: ApiEnv, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(Effect.runPromise(decodeCoreReply(Schema.Null, makeCoreClient(env.CORE).apiMaintenance())))
}

// Only provider-shaped OAuth credentials enter the provider. Browser Access,
// opaque tokens, development identity, and public viewer retain their precedence.
const oauthProvider = createOAuthProvider(app as unknown as ExportedHandler<ApiEnv>)
export default {
  async fetch(request: Request, env: ApiEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (isOAuthProviderPath(pathname)) {
      const limited = await tokenEndpointRateLimited(request, env)
      return limited ?? oauthProvider.fetch(request, env, ctx)
    }
    if (isOAuthAccessToken(request)) return oauthProvider.fetch(request, env, ctx)
    return app.fetch(request, env, ctx)
  },
  scheduled,
} satisfies ExportedHandler<ApiEnv>

export { RateLimiter } from './lib/rate-limiter-do'
export { WorkspaceHub } from './realtime/workspace-hub'
