import { and, eq } from 'drizzle-orm'
import { Predicate, Effect } from 'effect'
import { flattenError } from 'zod'

import { GetCodeHeatmapSchema } from '#contracts/inputs/code-heatmap.ts'
import { drizzle, schema } from '#db'
import { getCodeHeatmap as queryCodeHeatmap } from '#services/code-heatmap.ts'

import { effectiveProjectRole, isWorkspaceAdmin } from './access.ts'
import { NotFoundError, ValidationError } from './errors.ts'
import type { ServiceCtx } from './types.ts'

export type { CodeHeatmapEntry, ContentionHeatmapEntry } from '#services/code-heatmap.ts'

const assertProjectExists = async function assertProjectExists(ctx: ServiceCtx, projectId: string): Promise<void> {
  const orm = drizzle(ctx.db, { schema })
  const project = await orm
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, ctx.workspaceId)))
    .get()
  if (!project) {
    throw new NotFoundError('Project not found')
  }
  // PROJ-311: a non-admin without a grant can't see the project's metrics.
  if (!isWorkspaceAdmin(ctx.role) && Predicate.isNullish(await effectiveProjectRole(ctx, projectId))) {
    throw new NotFoundError('Project not found')
  }
}

export const getCodeHeatmap = async function getCodeHeatmap(ctx: ServiceCtx, raw: unknown) {
  const result = GetCodeHeatmapSchema.safeParse(raw)
  if (!result.success) {
    throw new ValidationError(flattenError(result.error))
  }
  await assertProjectExists(ctx, result.data.projectId)
  return Effect.runPromise(queryCodeHeatmap(ctx.db, ctx.workspaceId, result.data))
}
