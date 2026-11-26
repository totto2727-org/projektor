import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { drizzle, schema } from '#db'
import { SQL_NULL } from '#db/sql-null.ts'

import type { ServiceCtx } from './types.ts'

export const recordActivity = async function recordActivity(
  ctx: ServiceCtx,
  opts: Readonly<{
    entityType: 'issue' | 'wiki_page' | 'project' | 'group'
    entityId: string
    action: 'created' | 'updated' | 'deleted'
    diff?: Record<string, unknown>
  }>,
): Promise<void> {
  const orm = drizzle(ctx.db, { schema })
  await orm.insert(schema.activity).values(
    fieldsInOrder([
      ['id', crypto.randomUUID()],
      ['workspaceId', ctx.workspaceId],
      ['entityType', opts.entityType],
      ['entityId', opts.entityId],
      ['actorId', ctx.userId],
      ['action', opts.action],
      ['diff', opts.diff ?? SQL_NULL],
      ['createdAt', currentEpochSeconds()],
    ]),
  )
}
