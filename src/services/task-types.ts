import { drizzle, schema } from "#db";
import { asc, eq } from "drizzle-orm";
import { queryEffect } from "./errors";

export function listTaskTypes(db: D1Database, workspaceId: string) {
	return queryEffect("listTaskTypes", async () => {
		const rows = await drizzle(db, { schema })
			.select()
			.from(schema.taskTypes)
			.where(eq(schema.taskTypes.workspaceId, workspaceId))
			.orderBy(asc(schema.taskTypes.position), asc(schema.taskTypes.name));
		return rows.map(({ isDefault, workspaceId, ...rest }) => ({
			...rest,
			workspace_id: workspaceId,
			is_default: isDefault,
		}));
	});
}
export type TaskTypeRow = Omit<
	typeof schema.taskTypes.$inferSelect,
	"isDefault" | "workspaceId"
> & { workspace_id: string; is_default: number };
