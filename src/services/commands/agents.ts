import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { String, Array, Predicate } from 'effect'
import { flattenError } from 'zod'

import {
  EndAgentSchema,
  FinishWorkSchema,
  HeartbeatAgentSchema,
  ListActiveAgentsSchema,
  RegisterAgentSchema,
  StartWorkSchema,
} from '#contracts/inputs/agents.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { drizzle, schema } from '#db'

import { assertIssueAccess, visibleProjectPredicate } from './access.ts'
import { agentSessionCredential, assertAgentSessionAccess, resolveAgentSessionId } from './agent-identity.ts'
import { postMessage } from './agent-messages.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import { claimFiles, releaseClaimsForAgent } from './file-claims.ts'
import { claimIssue, releaseLeasesForAgent } from './issue-leases.ts'
import { updateIssue } from './issues.ts'
import { resolveVisibleProjectIdParam } from './projects.ts'
import type { ServiceCtx } from './types.ts'

const ACTIVE_TTL = 120

/*
 * PROJ-336: agent_sessions.kind is caller-declared at register_agent with no
 * privilege check (the original review-gate spoof vector; PROJ-287 rebound the
 * gate to live leases instead, ignoring kind entirely). It drives no remaining
 * behavior, so it's excluded here to stop it reading as a trust/attribution
 * signal in list_active_agents and register/heartbeat/end responses.
 */
const AGENT_SESSION_COLUMNS = {
  id: schema.agentSessions.id,
  workspaceId: schema.agentSessions.workspaceId,
  issueId: schema.agentSessions.issueId,
  tokenId: schema.agentSessions.tokenId,
  name: schema.agentSessions.name,
  status: schema.agentSessions.status,
  startedAt: schema.agentSessions.startedAt,
  lastHeartbeatAt: schema.agentSessions.lastHeartbeatAt,
  endedAt: schema.agentSessions.endedAt,
}

type AgentSession = Pick<typeof schema.agentSessions.$inferSelect, keyof typeof AGENT_SESSION_COLUMNS>
type ActiveAgent = AgentSession & { issueRef: string | null; live: boolean }
interface StartedWork {
  claimedFiles: Awaited<ReturnType<typeof claimFiles>>['created']
  lease: Awaited<ReturnType<typeof claimIssue>>
  sessionId: string
}

const isApiTokenMethod = function isApiTokenMethod(method: string): boolean {
  return method === 'pk' || method === 'pat'
}

export const registerAgent = async function registerAgent(ctx: ServiceCtx, raw: unknown): Promise<AgentSession> {
  const result = RegisterAgentSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const { issueId, name } = result.data

  const orm = drizzle(ctx.db, { schema })

  if (Predicate.isNotNullish(issueId) && String.isNonEmpty(issueId)) {
    await assertIssueAccess(ctx, issueId, 'edit')
  }

  const id = crypto.randomUUID()
  const now = currentEpochSeconds()

  /*
   * PROJ-336: kind is no longer read from the caller — see AGENT_SESSION_COLUMNS
   * for why it's dropped from every response. The DB column keeps its "agent"
   * default so existing rows/queries are unaffected.
   */
  await orm.insert(schema.agentSessions).values({
    id,
    workspaceId: ctx.workspaceId,
    issueId: issueId ?? null,
    /*
     * PROJ-894: the credential is recorded so an omitted agentId can later resolve to
     * this session. token_id keeps its FK meaning (api_tokens.id), so it is only set
     * for pk/pat credentials; an OAuth grant id lives in credential_id alone.
     */
    tokenId: ctx.auth?.credentialId && isApiTokenMethod(ctx.auth.method) ? ctx.auth.credentialId : null,
    authMethod: ctx.auth?.method ?? null,
    credentialId: agentSessionCredential(ctx) ?? null,
    name,
    status: 'active',
    startedAt: now,
    lastHeartbeatAt: now,
    endedAt: null,
  })

  const row = await orm
    .select(AGENT_SESSION_COLUMNS)
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get()

  // Row was just inserted; SELECT immediately after guarantees it exists
  return row!
}

/**
 * PROJ-929: register_agent + claim_issue + claim_files (if paths given) + post_message
 * in one call, replacing that 4-call sequence with the caller's own conflict handling
 * intact — claimIssue/claimFiles throw the same ConflictError/ValidationError they
 * always have, unchanged.
 *
 * All-or-nothing with compensating cleanup: D1 has no cross-call interactive
 * transaction, so this is a compensating-action sequence rather than a
 * single atomic write. If claim_issue or claim_files fails after the session was
 * registered, the session is ended immediately (which also releases anything it did
 * manage to claim before the failure), so no live, unaccounted-for session/lease/claim
 * is left behind by a failed start_work call in the ordinary case. If the process
 * itself crashes mid-call (so the compensating end_agent never runs), the claims it
 * made are still reclaimable by the next caller once the session's heartbeat goes
 * stale after ACTIVE_TTL (120s) — see claim_issue/claim_files's stale-holder reclaim.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {unknown} raw The issue ID, agent name and optional file paths.
 * @returns {Promise<{sessionId: string, lease: Awaited<ReturnType<typeof claimIssue>>, claimedFiles: Awaited<ReturnType<typeof claimFiles>>['created']}>}
 * The created session, issue lease, and newly claimed files.
 */
export const startWork = async function startWork(ctx: ServiceCtx, raw: unknown): Promise<StartedWork> {
  const result = StartWorkSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const { issue: issueId, paths, name } = result.data

  const session = await registerAgent(ctx, { name, issueId })

  try {
    const lease = await claimIssue(ctx, { issueId, agentId: session.id })

    const claimed =
      paths && Array.isArrayNonEmpty(paths) ? await claimFiles(ctx, { issueId, agentId: session.id, paths }) : null

    await postMessage(ctx, {
      scope: `issue:${issueId}`,
      agentId: session.id,
      body: `${name} started work`,
    })

    return {
      sessionId: session.id,
      lease,
      claimedFiles: claimed?.created ?? [],
    }
  } catch (error) {
    try {
      await endAgent(ctx, { id: session.id })
    } catch (error) {
      console.error('startWork: compensating endAgent failed', error)
    }
    throw error
  }
}

export const heartbeatAgent = async function heartbeatAgent(ctx: ServiceCtx, raw: unknown): Promise<AgentSession> {
  const result = HeartbeatAgentSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  /*
   * PROJ-894: heartbeat resolves against still-active sessions (not only live ones) —
   * this call is what revives a session that just went stale.
   */
  const id = await resolveAgentSessionId(ctx, result.data.id, { includeStale: true })

  const orm = drizzle(ctx.db, { schema })
  const existing = await orm
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(
      and(
        eq(schema.agentSessions.id, id),
        eq(schema.agentSessions.workspaceId, ctx.workspaceId),
        eq(schema.agentSessions.status, 'active'),
      ),
    )
    .get()
  if (!existing) {
    throw new NotFoundError('Agent session not found')
  }

  const now = currentEpochSeconds()
  await orm
    .update(schema.agentSessions)
    .set({ lastHeartbeatAt: now })
    .where(and(eq(schema.agentSessions.id, id), eq(schema.agentSessions.workspaceId, ctx.workspaceId)))

  const row = await orm
    .select(AGENT_SESSION_COLUMNS)
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get()

  // Row was just updated; SELECT immediately after guarantees it exists
  return row!
}

export async function endAgent(ctx: ServiceCtx, raw: unknown): Promise<AgentSession> {
  const result = EndAgentSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const id = await resolveAgentSessionId(ctx, result.data.id, {
    includeStale: true,
    allowAdministrativeOverride: true,
  })

  const orm = drizzle(ctx.db, { schema })
  const existing = await orm
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(and(eq(schema.agentSessions.id, id), eq(schema.agentSessions.workspaceId, ctx.workspaceId)))
    .get()
  if (!existing) {
    throw new NotFoundError('Agent session not found')
  }

  const now = currentEpochSeconds()
  await orm
    .update(schema.agentSessions)
    .set({ endedAt: now, status: 'ended' })
    .where(and(eq(schema.agentSessions.id, id), eq(schema.agentSessions.workspaceId, ctx.workspaceId)))

  await releaseClaimsForAgent(ctx, id)
  await releaseLeasesForAgent(ctx, id)

  const row = await orm
    .select(AGENT_SESSION_COLUMNS)
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.id, id))
    .get()

  // Row was just updated; SELECT immediately after guarantees it exists
  return row!
}

/**
 * PROJ-929: optionally transitions the issue via the existing updateIssue path (so
 * completion-report/review-gate rules apply exactly as they do for a plain
 * update_issue call), then ends the session — which already releases every claim and
 * lease it holds (see endAgent). Replaces release_issue + release_files + end_agent
 * (+ an update_issue call, if the issue is being closed) with one call.
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {unknown} raw The session and issue IDs, optional status and completion report.
 * @returns {ReturnType<typeof endAgent>} The ended session after the issue update, if requested.
 */
export const finishWork = async function finishWork(ctx: ServiceCtx, raw: unknown): Promise<AgentSession> {
  const result = FinishWorkSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const { sessionId, issue: issueId, completionReport, status } = result.data
  await assertIssueAccess(ctx, issueId, 'edit')
  await assertAgentSessionAccess(ctx, sessionId)

  if (Predicate.isNotNullish(status) || Predicate.isNotNullish(completionReport)) {
    await updateIssue(ctx, issueId, {
      ...(Predicate.isNotNullish(status) ? { status } : {}),
      ...(Predicate.isNotNullish(completionReport) ? { completionReport } : {}),
      /*
       * Attributes the transition to this session for the PROJ-375 audit flag and
       * the review-gate's completion-report requirement, exactly as a caller passing
       * agentSessionId on a plain update_issue already does.
       */
      agentSessionId: sessionId,
    })
  }

  return endAgent(ctx, { id: sessionId })
}

/**
 * PROJ-932: defaults to live entries only (status='active' AND heartbeat inside the
 * TTL) — this list was already live-only before PROJ-932; what's new is `includeStale`,
 * which surfaces a session that is still `active` but has stopped heartbeating (a
 * crashed agent whose staleness the fleet might want to see). An `ended` session is
 * never returned, with or without `includeStale` — that flag widens the heartbeat
 * check, it doesn't reach into ended sessions. Each item carries a `live` boolean
 * (true when its heartbeat is inside the TTL) and, when linked to an issue, that
 * issue's display ref (issueRef, e.g. "PROJ-857").
 *
 * @param {ServiceCtx} ctx The caller and workspace database.
 * @param {unknown} raw The optional issue and project filters and stale-session policy.
 * @returns {Promise<{items: (Awaited<ReturnType<typeof registerAgent>> & {issueRef: string | null, live: boolean})[]}>}
 * Visible active sessions with current liveness and issue references.
 */
export const listActiveAgents = async function listActiveAgents(
  ctx: ServiceCtx,
  raw: unknown,
): Promise<{ items: ActiveAgent[] }> {
  const result = ListActiveAgentsSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  const { issueId, includeStale } = result.data
  const projectId = result.data.projectId ? await resolveVisibleProjectIdParam(ctx, result.data.projectId) : undefined

  const orm = drizzle(ctx.db, { schema })
  const cutoff = currentEpochSeconds() - ACTIVE_TTL

  /*
   * `status='active'` is unconditional — an ended session is never returned, whether or
   * not includeStale is set. includeStale only lifts the heartbeat-freshness check below.
   */
  const conditions = [eq(schema.agentSessions.workspaceId, ctx.workspaceId), eq(schema.agentSessions.status, 'active')]
  if (includeStale !== true) {
    conditions.push(gt(schema.agentSessions.lastHeartbeatAt, cutoff))
  }

  if (Predicate.isNotNullish(issueId) && String.isNonEmpty(issueId)) {
    conditions.push(eq(schema.agentSessions.issueId, issueId))
  }
  /*
   * PROJ-932: a session with no issue link has no project to check, so it's excluded
   * once a projectId filter is given (see the list_active_agents tool description).
   */
  if (Predicate.isNotNullish(projectId) && String.isNonEmpty(projectId)) {
    conditions.push(eq(schema.issues.projectId, projectId))
  }

  /*
   * PROJ-316: a non-admin member only sees agents working an issue in a project
   * they can access. Agents not tied to any issue carry no project, so they stay
   * workspace-visible. Owner/admin (predicate undefined) see every agent. The LEFT
   * JOIN to issues below lets the predicate take the joined project id column
   * directly instead of a correlated subquery.
   */
  const vis = visibleProjectPredicate(ctx, schema.issues.projectId)
  if (vis) {
    conditions.push(or(isNull(schema.agentSessions.issueId), vis) ?? vis)
  }

  const rows = await orm
    .select({
      ...AGENT_SESSION_COLUMNS,
      projectKey: schema.projects.key,
      issueNumber: schema.issues.number,
    })
    .from(schema.agentSessions)
    .leftJoin(
      schema.issues,
      and(eq(schema.agentSessions.issueId, schema.issues.id), eq(schema.issues.workspaceId, ctx.workspaceId)),
    )
    .leftJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
    .where(and(...conditions))
    .orderBy(desc(schema.agentSessions.startedAt))

  const items = rows.map(({ projectKey, issueNumber, ...session }) => ({
    ...session,
    issueRef:
      session.issueId && Predicate.isNotNullish(projectKey) && String.isNonEmpty(projectKey)
        ? `${projectKey}-${issueNumber}`
        : null,
    live: session.lastHeartbeatAt > cutoff,
  }))

  return { items }
}
