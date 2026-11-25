import { and, eq, isNull } from 'drizzle-orm'
import { Predicate } from 'effect'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { drizzle, schema } from '#db'

import { assertProjectAccess } from './access.ts'
import { NotFoundError } from './errors.ts'
import type { ServiceCtx } from './types.ts'
import { idFirst, idOrSlugMatch } from './wiki-lookup.ts'

type DraftOrm = ReturnType<typeof drizzle<typeof schema>>
type DraftPage = Pick<typeof schema.wikiPages.$inferSelect, 'id' | 'slug' | 'projectId'>

interface ResolvedDraftTarget {
  id: string
  slug: string
}

const findRedirectedDraftPage = async function findRedirectedDraftPage(
  orm: DraftOrm,
  ctx: ServiceCtx,
  idOrSlug: string,
): Promise<DraftPage | undefined> {
  const redirect = await orm
    .select({ pageId: schema.wikiRedirects.pageId })
    .from(schema.wikiRedirects)
    .where(and(eq(schema.wikiRedirects.workspaceId, ctx.workspaceId), eq(schema.wikiRedirects.oldSlug, idOrSlug)))
    .get()
  if (!redirect) {
    return undefined
  }
  return orm
    .select(
      fieldsInOrder([
        ['id', schema.wikiPages.id],
        ['slug', schema.wikiPages.slug],
        ['projectId', schema.wikiPages.projectId],
      ]),
    )
    .from(schema.wikiPages)
    .where(
      and(
        eq(schema.wikiPages.id, redirect.pageId),
        eq(schema.wikiPages.workspaceId, ctx.workspaceId),
        isNull(schema.wikiPages.deletedAt),
      ),
    )
    .get()
}

/*
 * PROJ-495. Drafts follow the Wiki's id-first page resolution, historical slugs and
 * project visibility policy. This lookup stays independent of the Wiki commands.
 */
export const resolveDraftTarget = async function resolveDraftTarget(
  ctx: ServiceCtx,
  idOrSlug: string,
): Promise<ResolvedDraftTarget> {
  const orm = drizzle(ctx.db, { schema })
  const direct = await orm
    .select(
      fieldsInOrder([
        ['id', schema.wikiPages.id],
        ['slug', schema.wikiPages.slug],
        ['projectId', schema.wikiPages.projectId],
      ]),
    )
    .from(schema.wikiPages)
    .where(
      and(
        idOrSlugMatch(idOrSlug),
        eq(schema.wikiPages.workspaceId, ctx.workspaceId),
        /*
         * PROJ-496: no drafts on a trashed page — same "trashed = gone" rule as every
         * other page reference entry point (services/wiki.ts).
         */
        isNull(schema.wikiPages.deletedAt),
      ),
    )
    .orderBy(idFirst(idOrSlug))
    .get()

  const page = direct ?? (await findRedirectedDraftPage(orm, ctx, idOrSlug))
  if (!page) {
    throw new NotFoundError('Wiki page not found')
  }

  if (Predicate.isNotNullish(page.projectId)) {
    await assertProjectAccess(ctx, page.projectId, 'read', {
      notFoundMessage: 'Wiki page not found',
      projectLoadedFromWorkspaceRow: true,
    })
  }
  return { id: page.id, slug: page.slug }
}
