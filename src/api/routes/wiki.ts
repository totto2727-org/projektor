import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { coreFileRequest } from '../http/core-files.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
import { ctxFromHono } from '../services/types.ts'
import * as wikiDraftsService from '../services/wiki-drafts.ts'
import * as wikiWatchersService from '../services/wiki-watchers.ts'
import * as wikiService from '../services/wiki.ts'

const router = new Hono<HonoEnv>()

router.get('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const projectId = httpContext.req.query('projectId')
    const parentId = httpContext.req.query('parentId')
    const type = httpContext.req.query('type')
    const status = httpContext.req.query('status')
    const tags = httpContext.req.query('tags')
    /*
     * PROJ-525: "true"/"1" opt-in for the template-picker's own use case; any other
     * value (including absent) leaves the schema's default false in place.
     */
    const includeTemplatesParam = httpContext.req.query('includeTemplates')
    const includeTemplates = includeTemplatesParam === 'true' || includeTemplatesParam === '1' ? true : undefined
    return httpContext.json(
      await wikiService.listWikiPages(ctx, {
        parentId,
        projectId,
        type,
        status,
        tags,
        includeTemplates,
        includeWorkspacePages: httpContext.req.query('includeWorkspacePages'),
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/tree', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const projectId = httpContext.req.query('projectId')
    return httpContext.json(
      await wikiService.getWikiTree(ctx, {
        projectId,
        includeWorkspacePages: httpContext.req.query('includeWorkspacePages'),
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/search', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  const q = httpContext.req.query('q') ?? ''
  const projectId = httpContext.req.query('projectId')
  const limit = httpContext.req.query('limit')
  const offset = httpContext.req.query('offset')
  const updatedSince = httpContext.req.query('updatedSince')
  const type = httpContext.req.query('type')
  const status = httpContext.req.query('status')
  const tags = httpContext.req.query('tags')
  try {
    return httpContext.json(
      await wikiService.searchWiki(ctx, {
        query: q,
        projectId,
        limit,
        offset,
        updatedSince,
        type,
        status,
        tags,
        includeWorkspacePages: httpContext.req.query('includeWorkspacePages'),
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/broken-links', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const projectId = httpContext.req.query('projectId')
    return httpContext.json(await wikiService.listBrokenWikiLinks(ctx, { projectId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// PROJ-489 (R7): must be registered before the /:slug catch-all below, same as
// /tree, /search, /broken-links above.
router.get('/stale-pages', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const projectId = httpContext.req.query('projectId')
    const limit = httpContext.req.query('limit')
    const offset = httpContext.req.query('offset')
    return httpContext.json(
      await wikiService.listStaleWikiPages(ctx, {
        projectId,
        limit,
        offset,
        includeWorkspacePages: httpContext.req.query('includeWorkspacePages'),
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// PROJ-491 (R9): must be registered before the /:slug catch-all below, same as
// /tree, /search, /broken-links, /stale-pages above.
router.get('/templates', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const projectId = httpContext.req.query('projectId')
    return httpContext.json(await wikiService.listWikiTemplates(ctx, { projectId }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/backfill-links', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext).catch(() => ({}))
    return httpContext.json(await wikiService.backfillWikiLinks(ctx, body))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

/*
 * PROJ-493 (R11): must be registered before the /:slug catch-all below, same as every
 * other fixed-path route above.
 */
router.get('/watches', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiWatchersService.listWikiWatches(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/notifications', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const unreadOnly = httpContext.req.query('unreadOnly')
    const limit = httpContext.req.query('limit')
    const offset = httpContext.req.query('offset')
    return httpContext.json(await wikiWatchersService.listWikiNotifications(ctx, { unreadOnly, limit, offset }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/notifications/read', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext).catch(() => ({}))
    return httpContext.json(await wikiWatchersService.markWikiNotificationsRead(ctx, body))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

/*
 * PROJ-496 (R14): must be registered before the /:slug catch-all below, same as every
 * other fixed-path route above.
 */
router.get('/trash', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const projectId = httpContext.req.query('projectId')
    const limit = httpContext.req.query('limit')
    const offset = httpContext.req.query('offset')
    return httpContext.json(await wikiService.listWikiTrash(ctx, { projectId, limit, offset }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/trash/:id/undelete', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiService.undeleteWikiPage(ctx, httpContext.req.param('id')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/purge-trash', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiService.purgeExpiredWikiPages(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/changes', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const since = httpContext.req.query('since')
    const limit = httpContext.req.query('limit')
    const projectId = httpContext.req.query('projectId')
    const watchedOnly = httpContext.req.query('watchedOnly')
    return httpContext.json(await wikiWatchersService.listWikiChanges(ctx, { since, limit, projectId, watchedOnly }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

/*
 * PROJ-497 (R15): must be registered before the /:slug catch-all below, same as every
 * other fixed-path route above. REST-only — see AGENTS.md's "Deliberate REST↔MCP
 * parity exceptions" for why (binary zip response, same rationale as file downloads).
 */
router.get('/export', (httpContext) => {
  const query = new URLSearchParams()
  for (const name of ['scope', 'projectId', 'pageId']) {
    const value = httpContext.req.query(name)
    if (value !== undefined) {
      query.set(name, value)
    }
  }
  return coreFileRequest(httpContext, `/wiki-export?${query}`)
})

router.get('/:slug/backlinks', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiService.getWikiBacklinks(ctx, httpContext.req.param('slug')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:slug/revisions/:revisionId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(
      await wikiService.getWikiRevision(ctx, httpContext.req.param('slug'), httpContext.req.param('revisionId')),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:slug/revisions/:revisionId/diff', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(
      await wikiService.getWikiRevisionDiff(ctx, httpContext.req.param('slug'), httpContext.req.param('revisionId'), {
        against: httpContext.req.query('against'),
      }),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:slug/revisions', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiService.listWikiRevisions(ctx, httpContext.req.param('slug')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:slug', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const page = await wikiService.getWikiPage(ctx, httpContext.req.param('slug'))
    // PROJ-809: the ETag is the revision pointer for the returned content.
    httpContext.header('ETag', `"${page.revisionId ?? 'none'}"`)
    return httpContext.json(page)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext)
    return httpContext.json(await wikiService.createWikiPage(ctx, body), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.put('/:slug', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext)
    return httpContext.json(await wikiService.updateWikiPage(ctx, httpContext.req.param('slug'), body))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/:slug/verify', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiService.verifyWikiPage(ctx, httpContext.req.param('slug')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/:slug/watch', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext).catch(() => ({}))
    return httpContext.json(await wikiWatchersService.watchWikiPage(ctx, httpContext.req.param('slug'), body))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:slug/watch', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiWatchersService.unwatchWikiPage(ctx, httpContext.req.param('slug')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:slug/draft', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiDraftsService.getWikiDraft(ctx, httpContext.req.param('slug')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.put('/:slug/draft', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext)
    return httpContext.json(await wikiDraftsService.saveWikiDraft(ctx, httpContext.req.param('slug'), body))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:slug/draft', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await wikiDraftsService.discardWikiDraft(ctx, httpContext.req.param('slug')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.patch('/:slug', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const body = await jsonBody(httpContext)
    return httpContext.json(await wikiService.patchWikiPage(ctx, httpContext.req.param('slug'), body))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:slug', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    const cascade = httpContext.req.query('cascade') === 'true'
    return httpContext.json(await wikiService.deleteWikiPage(ctx, httpContext.req.param('slug'), { cascade }))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as wikiRouter }
