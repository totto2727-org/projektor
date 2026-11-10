import { and, desc, eq, gt, isNull, or, type SQL } from 'drizzle-orm'

import { drizzle, schema } from '#db'

import { assertIssueAccess, isWorkspaceAdmin } from './access'
import { ForbiddenError, NotFoundError, ValidationError } from './errors'
import type { ServiceCtx } from './types'

// Mirrors ACTIVE_TTL in services/agents.ts (and SESSION_TTL_SECONDS in
// services/issue-leases.ts). Duplicated rather than imported: both of those files import
// this one, so importing back would cycle.
const LIVE_TTL_SECONDS = 120

export function agentSessionCredential(ctx: ServiceCtx): string | undefined {
  if (ctx.auth?.credentialId) return ctx.auth.credentialId
  if (ctx.auth?.kind === 'human' && (ctx.auth.method === 'access' || ctx.auth.method === 'dev')) {
    return `user:${ctx.userId}`
  }
  return undefined
}

/** A supplied session ID identifies a resource, never authority to impersonate its holder.
 * Legacy sessions without an ownership key are manageable only by workspace administrators.
 * New browser sessions use a namespaced user key, not a fabricated API-token foreign key.
 */
export async function assertAgentSessionAccess(
  ctx: ServiceCtx,
  id: string,
  options: { allowAdministrativeOverride?: boolean } = {},
): Promise<void> {
  const session = await drizzle(ctx.db, { schema })
    .select({
      credentialId: schema.agentSessions.credentialId,
      tokenId: schema.agentSessions.tokenId,
      issueId: schema.agentSessions.issueId,
    })
    .from(schema.agentSessions)
    .where(and(eq(schema.agentSessions.id, id), eq(schema.agentSessions.workspaceId, ctx.workspaceId)))
    .get()
  if (!session) throw new NotFoundError('Agent session not found')
  if (!(options.allowAdministrativeOverride && isWorkspaceAdmin(ctx.role))) {
    const credential = agentSessionCredential(ctx)
    if (!credential || credential !== (session.credentialId ?? session.tokenId)) {
      throw new ForbiddenError('Agent session belongs to another credential')
    }
  }
  if (session.issueId) await assertIssueAccess(ctx, session.issueId, 'edit')
}

/**
 * PROJ-894: resolve the agent session a call acts as.
 *
 * An explicit `agentId` selects an owned session, even for administrators.
 * Only internal cleanup callers may explicitly enable administrative override.
 * Without one, the credential the call authenticated
 * with (ctx.auth.credentialId, recorded on the session by register_agent) is looked up:
 * exactly one matching session means "that one". Zero or several is a validation error
 * telling the caller to pass agentId. Nothing is held per connection — the answer is
 * derived from the session table on every call, so this stays stateless (PROJ-452).
 *
 * Fleets that share one `pk_` token will normally have several live sessions on it, so
 * for them this always errors and they keep passing agentId — by design.
 *
 * `includeStale`: heartbeat_agent/end_agent may fall back to a session that has just gone
 * stale (that call is what revives it), but only when the credential has no live session;
 * the claim path requires a live one, since a dead session can't hold a lease.
 */
export async function resolveAgentSessionId(
  ctx: ServiceCtx,
  provided: string | undefined,
  opts: { includeStale?: boolean; allowAdministrativeOverride?: boolean } = {},
): Promise<string> {
  if (provided) {
    await assertAgentSessionAccess(ctx, provided, opts)
    return provided
  }

  const credentialId = agentSessionCredential(ctx)
  if (!credentialId) {
    throw new ValidationError({
      formErrors: [],
      fieldErrors: {
        agentId: ['no session on this credential — pass agentId from register_agent'],
      },
    })
  }

  const orm = drizzle(ctx.db, { schema })
  const base = [
    eq(schema.agentSessions.workspaceId, ctx.workspaceId),
    or(
      eq(schema.agentSessions.credentialId, credentialId),
      and(isNull(schema.agentSessions.credentialId), eq(schema.agentSessions.tokenId, credentialId)),
    ),
    eq(schema.agentSessions.status, 'active'),
  ]
  // Two rows are enough to tell "exactly one" from "several".
  const find = (extra: SQL[]) =>
    orm
      .select({ id: schema.agentSessions.id })
      .from(schema.agentSessions)
      .where(and(...base, ...extra))
      .orderBy(desc(schema.agentSessions.lastHeartbeatAt))
      .limit(2)

  const cutoff = Math.floor(Date.now() / 1000) - LIVE_TTL_SECONDS
  let rows = await find([gt(schema.agentSessions.lastHeartbeatAt, cutoff)])
  // heartbeat/end must be able to reach a session that has just gone stale (that call
  // revives it) — but only when no live session exists, so an abandoned session left
  // behind by a crash can't make a lone agent's id-less heartbeat ambiguous.
  if (rows.length === 0 && opts.includeStale) rows = await find([])

  if (rows.length === 1) {
    await assertAgentSessionAccess(ctx, rows[0].id, opts)
    return rows[0].id
  }

  throw new ValidationError({
    formErrors: [],
    fieldErrors: {
      agentId: [
        rows.length === 0
          ? 'no live session on this credential — pass agentId from register_agent'
          : `several ${opts.includeStale ? 'active' : 'live'} sessions on this credential — pass agentId from register_agent`,
      ],
    },
  })
}
