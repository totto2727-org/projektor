import { Hono } from 'hono'

import type { HonoEnv } from '#types'

import { jsonBody } from '../http/body.ts'
import { serviceErrToResponse } from '../http/error-adapter.ts'
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
} from '../services/groups.ts'
import { ctxFromHono } from '../services/types.ts'

const router = new Hono<HonoEnv>()

router.get('/:slug/groups', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await listGroups(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/:slug/groups', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await createGroup(ctx, await jsonBody(httpContext)), 201)
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

// Per-member group membership for the members-admin screen. Registered before
// /:slug/groups/:groupId so "member-groups" isn't captured as a group id.
router.get('/:slug/member-groups', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await listMemberGroups(ctx))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.get('/:slug/groups/:groupId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await getGroup(ctx, httpContext.req.param('groupId')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.patch('/:slug/groups/:groupId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await updateGroup(ctx, httpContext.req.param('groupId'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:slug/groups/:groupId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await deleteGroup(ctx, httpContext.req.param('groupId')))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.post('/:slug/groups/:groupId/members', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(
      await addGroupMember(ctx, httpContext.req.param('groupId'), await jsonBody(httpContext)),
      201,
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:slug/groups/:groupId/members/:userId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(
      await removeGroupMember(ctx, httpContext.req.param('groupId'), httpContext.req.param('userId')),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.put('/:slug/groups/:groupId/grants', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(await setGroupGrant(ctx, httpContext.req.param('groupId'), await jsonBody(httpContext)))
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

router.delete('/:slug/groups/:groupId/grants/:projectId', async (httpContext) => {
  const ctx = ctxFromHono(httpContext)
  try {
    return httpContext.json(
      await removeGroupGrant(ctx, httpContext.req.param('groupId'), httpContext.req.param('projectId')),
    )
  } catch (caughtError) {
    return serviceErrToResponse(httpContext, caughtError)
  }
})

export { router as groupsRouter }
