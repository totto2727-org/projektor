import { listLinksForIssue as queryLinks } from "@projektor/data-services/issue-links";
import { Effect } from "effect";
import { drizzle, schema } from "@projektor/db";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import {
	CreateIssueLinkSchema,
	DeleteIssueLinkSchema,
	type LinkTypeStoredEnum,
	ListIssueLinksSchema,
} from "../schemas/issues";
import { canWriteProject, effectiveProjectRole, isWorkspaceAdmin } from "./access";
import * as cache from "./cache";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { resolveIssueIdParam } from "./issues";
import type { ServiceCtx } from "./types";

// PROJ-311: linking touches two issues; a non-admin must be able to write to the
// project each issue belongs to (a missing grant reads as "issue not found").
async function requireIssueProjectWrite(
	ctx: ServiceCtx,
	projectId: string,
	notFoundLabel: string,
): Promise<void> {
	if (isWorkspaceAdmin(ctx.role)) return;
	const role = await effectiveProjectRole(ctx, projectId);
	if (role === null) throw new NotFoundError(notFoundLabel);
	if (!canWriteProject(role)) throw new ForbiddenError("Insufficient permissions");
}

type StoredLinkType = z.infer<typeof LinkTypeStoredEnum>;
// Normalise the (source, target, type) triple to its canonical stored form.
// 'blocked_by' (A blocked_by B) becomes 'blocks' (B blocks A).
// 'relates_to' and 'duplicates' are symmetric: canonicalise by lexicographic order.
function canonicalize(
	source: string,
	target: string,
	inputType: string,
): { source: string; target: string; type: StoredLinkType } {
	if (inputType === "blocked_by") {
		return { source: target, target: source, type: "blocks" };
	}
	const type = inputType as StoredLinkType;
	if (type === "relates_to" || type === "duplicates") {
		const [a, b] = source < target ? [source, target] : [target, source];
		return { source: a, target: b, type };
	}
	return { source, target, type };
}

export async function createLink(ctx: ServiceCtx, raw: unknown) {
	if (ctx.role === "viewer") throw new ForbiddenError("Insufficient permissions");
	const result = CreateIssueLinkSchema.safeParse(raw);
	if (!result.success) throw new ValidationError(result.error.flatten());
	const { type } = result.data;
	const sourceIssueId = await resolveIssueIdParam(
		ctx,
		result.data.sourceIssueId,
		"Source issue not found",
	);
	const targetIssueId = await resolveIssueIdParam(
		ctx,
		result.data.targetIssueId,
		"Target issue not found",
	);

	if (sourceIssueId === targetIssueId) {
		throw new ValidationError({ formErrors: ["An issue cannot link to itself"], fieldErrors: {} });
	}

	const canon = canonicalize(sourceIssueId, targetIssueId, type);
	const orm = drizzle(ctx.db, { schema });

	// Verify both issues exist and belong to this workspace
	const [src, tgt] = await Promise.all([
		orm
			.select({ id: schema.issues.id, projectId: schema.issues.projectId })
			.from(schema.issues)
			.where(
				and(eq(schema.issues.id, canon.source), eq(schema.issues.workspaceId, ctx.workspaceId)),
			)
			.get(),
		orm
			.select({ id: schema.issues.id, projectId: schema.issues.projectId })
			.from(schema.issues)
			.where(
				and(eq(schema.issues.id, canon.target), eq(schema.issues.workspaceId, ctx.workspaceId)),
			)
			.get(),
	]);
	if (!src) throw new NotFoundError("Source issue not found");
	if (!tgt) throw new NotFoundError("Target issue not found");
	await requireIssueProjectWrite(ctx, src.projectId, "Source issue not found");
	await requireIssueProjectWrite(ctx, tgt.projectId, "Target issue not found");

	// Reject duplicate pairs (same source+target+type in canonical form)
	const existing = await orm
		.select({ id: schema.issueLinks.id })
		.from(schema.issueLinks)
		.where(
			and(
				eq(schema.issueLinks.workspaceId, ctx.workspaceId),
				eq(schema.issueLinks.sourceIssueId, canon.source),
				eq(schema.issueLinks.targetIssueId, canon.target),
				eq(schema.issueLinks.type, canon.type),
			),
		)
		.get();
	if (existing) throw new ConflictError("This link already exists");

	const id = crypto.randomUUID();
	const now = Math.floor(Date.now() / 1000);

	await orm.insert(schema.issueLinks).values({
		id,
		workspaceId: ctx.workspaceId,
		sourceIssueId: canon.source,
		targetIssueId: canon.target,
		type: canon.type,
		createdById: ctx.userId,
		createdAt: now,
	});

	await cache.invalidate(ctx.kv, `issue:${ctx.workspaceId}:${canon.source}`);
	await cache.invalidate(ctx.kv, `issue:${ctx.workspaceId}:${canon.target}`);

	return { id };
}

export async function deleteLink(ctx: ServiceCtx, raw: unknown) {
	if (ctx.role === "viewer") throw new ForbiddenError("Insufficient permissions");
	const result = DeleteIssueLinkSchema.safeParse(raw);
	if (!result.success) throw new ValidationError(result.error.flatten());
	const { id } = result.data;

	const orm = drizzle(ctx.db, { schema });
	const existing = await orm
		.select({
			id: schema.issueLinks.id,
			sourceIssueId: schema.issueLinks.sourceIssueId,
			targetIssueId: schema.issueLinks.targetIssueId,
		})
		.from(schema.issueLinks)
		.where(and(eq(schema.issueLinks.id, id), eq(schema.issueLinks.workspaceId, ctx.workspaceId)))
		.get();
	if (!existing) throw new NotFoundError("Link not found");

	if (!isWorkspaceAdmin(ctx.role)) {
		const endpoints = await orm
			.select({ id: schema.issues.id, projectId: schema.issues.projectId })
			.from(schema.issues)
			.where(
				and(
					eq(schema.issues.workspaceId, ctx.workspaceId),
					inArray(schema.issues.id, [existing.sourceIssueId, existing.targetIssueId]),
				),
			);
		for (const ep of endpoints) {
			await requireIssueProjectWrite(ctx, ep.projectId, "Link not found");
		}
	}

	await orm
		.delete(schema.issueLinks)
		.where(and(eq(schema.issueLinks.id, id), eq(schema.issueLinks.workspaceId, ctx.workspaceId)));

	await cache.invalidate(ctx.kv, `issue:${ctx.workspaceId}:${existing.sourceIssueId}`);
	await cache.invalidate(ctx.kv, `issue:${ctx.workspaceId}:${existing.targetIssueId}`);

	return { ok: true };
}

export async function listLinksForIssue(ctx: ServiceCtx, raw: unknown) {
	const result = ListIssueLinksSchema.safeParse(raw);
	if (!result.success) throw new ValidationError(result.error.flatten());
	const issueId = await resolveIssueIdParam(ctx, result.data.issueId);

	const orm = drizzle(ctx.db, { schema });

	// PROJ-311: don't leak links for an issue in a project the user can't see.
	if (!isWorkspaceAdmin(ctx.role)) {
		const issue = await orm
			.select({ projectId: schema.issues.projectId })
			.from(schema.issues)
			.where(and(eq(schema.issues.id, issueId), eq(schema.issues.workspaceId, ctx.workspaceId)))
			.get();
		if (!issue || (await effectiveProjectRole(ctx, issue.projectId)) === null) {
			throw new NotFoundError("Issue not found");
		}
	}

	return Effect.runPromise(queryLinks(ctx.db, ctx.workspaceId, issueId));
}
