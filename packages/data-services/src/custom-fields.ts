import { drizzle, schema } from "@projektor/db";
import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { queryEffect } from "./errors";

export interface CustomFieldValue {
	key: string;
	label: string;
	type: string;
	value: string;
}

/** Leave room for workspace and other fixed predicates beneath D1's 100 bind cap. */
export async function inChunks<I, O>(
	items: readonly I[],
	op: (chunk: I[]) => Promise<O[]>,
): Promise<O[]> {
	const rows: O[] = [];
	for (let i = 0; i < items.length; i += 90) rows.push(...(await op(items.slice(i, i + 90))));
	return rows;
}

export function listCustomFieldDefs(
	db: D1Database,
	workspaceId: string,
	projectId?: string | null,
	visibility?: SQL,
) {
	return queryEffect("listCustomFieldDefs", async () => {
		const orm = drizzle(db, { schema });
		const conditions = [eq(schema.customFieldDefinitions.workspaceId, workspaceId)];
		if (visibility)
			conditions.push(or(isNull(schema.customFieldDefinitions.projectId), visibility)!);
		if (projectId !== undefined)
			conditions.push(
				projectId === null
					? isNull(schema.customFieldDefinitions.projectId)
					: or(
							isNull(schema.customFieldDefinitions.projectId),
							eq(schema.customFieldDefinitions.projectId, projectId),
						)!,
			);
		const rows = await orm
			.select()
			.from(schema.customFieldDefinitions)
			.where(and(...conditions))
			.orderBy(asc(schema.customFieldDefinitions.createdAt));
		return rows.map((d) => ({
			...d,
			options: d.options ? (JSON.parse(d.options) as string[]) : null,
		}));
	});
}

export function batchLoadCustomFields(
	db: D1Database,
	workspaceId: string,
	issueIds: readonly string[],
) {
	return queryEffect("batchLoadCustomFields", async () => {
		const orm = drizzle(db, { schema });
		const rows = await inChunks(issueIds, (chunk) =>
			orm
				.select({
					issueId: schema.customFieldValues.issueId,
					key: schema.customFieldDefinitions.key,
					label: schema.customFieldDefinitions.label,
					type: schema.customFieldDefinitions.type,
					value: schema.customFieldValues.value,
				})
				.from(schema.customFieldValues)
				.innerJoin(
					schema.customFieldDefinitions,
					eq(schema.customFieldDefinitions.id, schema.customFieldValues.fieldId),
				)
				.where(
					and(
						inArray(schema.customFieldValues.issueId, chunk),
						eq(schema.customFieldDefinitions.workspaceId, workspaceId),
					),
				),
		);
		const byIssue: Record<string, CustomFieldValue[]> = {};
		for (const r of rows)
			(byIssue[r.issueId] ??= []).push({
				key: r.key,
				label: r.label,
				type: r.type,
				value: r.value,
			});
		return byIssue;
	});
}
