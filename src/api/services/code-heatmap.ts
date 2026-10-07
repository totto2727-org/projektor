import { getCodeHeatmap as queryCodeHeatmap } from "#services/code-heatmap";
import { drizzle, schema } from "#db";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { GetCodeHeatmapSchema } from "../schemas/code-heatmap";
import { effectiveProjectRole, isWorkspaceAdmin } from "./access";
import { NotFoundError, ValidationError } from "./errors";
import type { ServiceCtx } from "./types";

export type { CodeHeatmapEntry, ContentionHeatmapEntry } from "#services/code-heatmap";

async function assertProjectExists(ctx: ServiceCtx, projectId: string): Promise<void> {
	const orm = drizzle(ctx.db, { schema });
	const project = await orm
		.select({ id: schema.projects.id })
		.from(schema.projects)
		.where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId)))
		.get();
	if (!project) throw new NotFoundError("Project not found");
	// PROJ-311: a non-admin without a grant can't see the project's metrics.
	if (!isWorkspaceAdmin(ctx.role) && (await effectiveProjectRole(ctx, projectId)) === null) {
		throw new NotFoundError("Project not found");
	}
}

export async function getCodeHeatmap(ctx: ServiceCtx, raw: unknown) {
	const result = GetCodeHeatmapSchema.safeParse(raw);
	if (!result.success) throw new ValidationError(result.error.flatten());
	await assertProjectExists(ctx, result.data.projectId);
	return Effect.runPromise(queryCodeHeatmap(ctx.db, ctx.workspaceId, result.data));
}
