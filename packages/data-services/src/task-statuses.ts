import { drizzle, schema } from "@projektor/db";
import { asc, eq } from "drizzle-orm";
import { queryEffect } from "./errors";

export function listTaskStatuses(db: D1Database, workspaceId: string) {
	return queryEffect("listTaskStatuses", async () => {
		const rows = await drizzle(db, { schema })
			.select()
			.from(schema.taskStatuses)
			.where(eq(schema.taskStatuses.workspaceId, workspaceId))
			.orderBy(asc(schema.taskStatuses.position), asc(schema.taskStatuses.name));
		return rows.map(({ isDefault, isReviewStep, workspaceId, ...rest }) => ({
			...rest,
			workspace_id: workspaceId,
			is_default: isDefault,
			is_review_step: isReviewStep,
		}));
	});
}
export type TaskStatusRow = typeof schema.taskStatuses.$inferSelect extends infer R
	? Omit<R, "isDefault" | "isReviewStep" | "workspaceId"> & {
			workspace_id: string;
			is_default: number;
			is_review_step: number;
		}
	: never;
