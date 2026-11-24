import * as wikiDraftsService from '#api/services/wiki-drafts.ts'
import * as wikiService from '#api/services/wiki.ts'

import { DESTRUCTIVE, PLAIN_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import type { MCPTool } from './types.ts'

export const wikiLifecycleTools: MCPTool[] = [
  {
    annotations: READ,
    description:
      "Get the calling user's saved server-side draft for a wiki page by id or slug " +
      '(server-side, so a draft survives a device switch). Returns null if there is no ' +
      'draft. `baseRevisionId` is the ' +
      "page's latest revision id as of when the draft was started — pass it straight " +
      "through to update_wiki_page/patch_wiki_page's own baseRevisionId when publishing, " +
      'so a stale draft hits the normal conflict response instead of silently clobbering ' +
      "someone else's newer edit.",
    async handler(input, ctx) {
      const { slug } = input as { slug: string }
      return wikiDraftsService.getWikiDraft(ctx, slug)
    },
    inputSchema: requiredObjectInputSchema(['slug'], { slug: describedInputProperty('string', 'Page ID or slug') }),
    name: 'get_wiki_draft',
  },
  {
    annotations: PLAIN_WRITE,
    description:
      "Save (upsert) the calling user's draft for a wiki page by id or slug. One draft " +
      'per (page, user) — calling this again overwrites the previous draft rather than ' +
      'creating a new one. Not a revision and not visible to other users. Callers should ' +
      'debounce their own call frequency (e.g. ~1s after the last edit) — this tool does ' +
      'no server-side throttling.',
    async handler(input, ctx) {
      const { slug, ...rest } = input as { slug: string; title: string; content: string }
      return wikiDraftsService.saveWikiDraft(ctx, slug, rest)
    },
    inputSchema: requiredObjectInputSchema(['slug', 'title', 'content'], {
      slug: describedInputProperty('string', 'Page ID or slug'),
      title: { type: 'string' },
      content: { type: 'string' },
      baseRevisionId: {
        type: 'string',
        nullable: true,
        description:
          "The page's latest revision id when this draft was started; null if the " + 'page had no revisions yet',
      },
    }),
    name: 'save_wiki_draft',
  },
  {
    annotations: DESTRUCTIVE,
    description:
      "Delete the calling user's draft for a wiki page by id or slug (a no-op if there " +
      'is none). Call this after a successful publish, or whenever the user explicitly ' +
      'discards unsaved changes.',
    async handler(input, ctx) {
      const { slug } = input as { slug: string }
      return wikiDraftsService.discardWikiDraft(ctx, slug)
    },
    inputSchema: requiredObjectInputSchema(['slug'], { slug: describedInputProperty('string', 'Page ID or slug') }),
    name: 'discard_wiki_draft',
  },
  {
    annotations: READ,
    description:
      'List trashed (soft-deleted) wiki pages in the workspace, optionally scoped to a ' +
      'project. Same visibility rule as list_wiki_pages — a project-scoped trashed page ' +
      'only appears for callers who could see that project. Each result includes ' +
      '`purgeAfter` (unix seconds) — the page is permanently removed by purge_wiki_trash ' +
      'once that time passes (30 days after deletion).',
    async handler(input, ctx) {
      return wikiService.listWikiTrash(ctx, input)
    },
    inputSchema: objectInputSchema({
      projectId: describedInputProperty('string', 'Restrict to trashed pages belonging to this project ID'),
      limit: { type: 'number', default: 50 },
      offset: { type: 'number', default: 0 },
    }),
    name: 'list_wiki_trash',
  },
  {
    annotations: PLAIN_WRITE,
    description:
      'Restore a trashed wiki page by ID (not slug — trashed pages can share a ' +
      'now-recycled slug; use list_wiki_trash to find the ID). Requires the same ' +
      'permission as delete_wiki_page. ' +
      'If this page was cascade-trashed together with descendants, the whole subtree is ' +
      "restored as one batch — the response's restoredCount reports how many pages came " +
      "back. Rejected with a structured conflict (no partial restore) if the ID's own " +
      "slug OR any descendant's slug has since been taken by another live page — the " +
      'conflict names the colliding slug; rename that page first, then retry. The ' +
      "restored page's parent may itself still be trashed; if so the page appears as a " +
      'root until the parent is also restored.',
    async handler(input, ctx) {
      const { id } = input as { id: string }
      return wikiService.undeleteWikiPage(ctx, id)
    },
    inputSchema: requiredObjectInputSchema(['id'], { id: describedInputProperty('string', 'Trashed page ID') }),
    name: 'undelete_wiki_page',
  },
  {
    annotations: DESTRUCTIVE,
    description:
      "Permanently remove every wiki page in the workspace that's been trashed for at " +
      'least 30 days — deletes R2 attachment objects, wiki_revisions/wiki_links/' +
      'wiki_watchers/wiki_drafts/wiki_redirects rows, and the page row itself, re-parenting ' +
      'any live child left pointing at a purged page. Irreversible. Owner/admin only. Also ' +
      'runs automatically once daily via a Workers Cron Trigger — call this manually only ' +
      'to force an off-cycle purge.',
    async handler(_input, ctx) {
      return wikiService.purgeExpiredWikiPages(ctx)
    },
    inputSchema: objectInputSchema({}),
    name: 'purge_wiki_trash',
  },
]
