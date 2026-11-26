import * as wikiService from '#api/services/wiki.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { PLAIN_WRITE, READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import { toPage } from './serialize.ts'
import type { MCPTool } from './types.ts'
import { INCLUDE_WORKSPACE_PAGES_PROPERTY } from './wiki-tool-fields.ts'

const DEFAULT_WIKI_MAINTENANCE_LIMIT = 50
const DEFAULT_WIKI_MAINTENANCE_OFFSET = 0

export const wikiMaintenanceTools: MCPTool[] = [
  {
    annotations: READ,
    description:
      'Get the wiki page hierarchy as a nested tree, optionally filtered by project. Returns ' +
      '`{items}` — the root nodes (see /projektor/agents/response-conventions/).',
    async handler(input, ctx) {
      return toPage(await wikiService.getWikiTree(ctx, input))
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        ['projectId', describedInputProperty('string', 'Filter to pages belonging to this project ID')],
        ['includeWorkspacePages', INCLUDE_WORKSPACE_PAGES_PROPERTY],
      ]),
    ),
    name: 'wiki_tree',
  },
  {
    annotations: READ,
    description:
      'List pages that link to the given page via a resolved [[wikilink]] or same-workspace ' +
      'URL (id-backed, so renames never break a backlink). Each result includes a snippet of ' +
      "the citing text when it can still be located in the source page's current content.",
    async handler(input, ctx) {
      const { slug } = input as { slug: string }
      return wikiService.getWikiBacklinks(ctx, slug)
    },
    inputSchema: requiredObjectInputSchema(['slug'], {
      slug: describedInputProperty('string', 'Page ID or slug to find backlinks for'),
    }),
    name: 'get_backlinks',
  },
  {
    annotations: READ,
    description:
      'List unresolved wiki links in the workspace — [[Target]]/URL links whose target ' +
      "title or slug didn't match any page at write time. Useful as a maintenance queue. " +
      'A broken link auto-resolves when a page matching its title/slug is created, ' +
      'renamed to match it, or restored from the trash (PROJ-814); backfill_wiki_links ' +
      '(or re-saving the linking page) also still re-resolves it.',
    async handler(input, ctx) {
      return wikiService.listBrokenWikiLinks(ctx, input)
    },
    inputSchema: objectInputSchema({
      projectId: describedInputProperty('string', 'Restrict to links from pages in this project'),
    }),
    name: 'list_broken_wiki_links',
  },
  {
    annotations: PLAIN_WRITE,
    description:
      'Idempotent, safe-to-re-run recompute of the wiki_links graph for pages in the ' +
      'workspace, one page-budget-sized chunk per call (default 200, max 500) so it can run ' +
      'incrementally and resume after a timeout. Skips trashed pages. Pass back `nextCursor` ' +
      'as `cursor` to continue; call repeatedly until `nextCursor` is null. `updatedSince` ' +
      '(unix seconds) limits the scope to pages touched at/after that time. Owner/admin only.',
    async handler(input, ctx) {
      const result = await wikiService.backfillWikiLinks(ctx, input)
      return result
    },
    inputSchema: objectInputSchema({
      cursor: fieldsInOrder([
        ['type', 'object'],
        ['description', "Resume point from a previous call's nextCursor"],
        ['required', ['updatedAt', 'id']],
        [
          'properties',
          fieldsInOrder([
            ['updatedAt', { type: 'number' }],
            ['id', { type: 'string' }],
          ]),
        ],
      ]),
      pageBudget: describedInputProperty('number', 'Max pages to process in this call (1-500, default 200)'),
      updatedSince: describedInputProperty('number', 'Only process pages updated at/after this unix-seconds timestamp'),
    }),
    name: 'backfill_wiki_links',
  },
  {
    annotations: READ,
    description: 'List revision history for a wiki page',
    async handler(input, ctx) {
      const { slug } = input as { slug: string }
      return wikiService.listWikiRevisions(ctx, slug)
    },
    inputSchema: requiredObjectInputSchema(['slug'], { slug: { type: 'string' } }),
    name: 'list_wiki_revisions',
  },
  {
    annotations: READ,
    description: 'Get the content of a specific wiki revision by its ID',
    async handler(input, ctx) {
      const { slug, revisionId } = input as { slug: string; revisionId: string }
      return wikiService.getWikiRevision(ctx, slug, revisionId)
    },
    inputSchema: requiredObjectInputSchema(
      ['slug', 'revisionId'],
      fieldsInOrder([
        ['slug', { type: 'string' }],
        ['revisionId', { type: 'string' }],
      ]),
    ),
    name: 'get_wiki_revision',
  },
  {
    annotations: READ,
    description:
      'Server-side unified diff between one revision (revisionId) and either another ' +
      "revision or the page's current content. `against` is a revision id or the literal " +
      'string "current" (default when omitted). Same unified diff format as ' +
      "update_wiki_page/patch_wiki_page's conflict responses (--- base / +++ current, " +
      '@@ hunk headers).',
    async handler(input, ctx) {
      const { slug, revisionId, against } = input as {
        slug: string
        revisionId: string
        against?: string
      }
      return wikiService.getWikiRevisionDiff(ctx, slug, revisionId, { against })
    },
    inputSchema: requiredObjectInputSchema(
      ['slug', 'revisionId'],
      fieldsInOrder([
        ['slug', { type: 'string' }],
        ['revisionId', { type: 'string' }],
        ['against', describedInputProperty('string', 'Another revision id, or "current" (default)')],
      ]),
    ),
    name: 'get_wiki_revision_diff',
  },
  {
    annotations: PLAIN_WRITE,
    description:
      'Stamp a wiki page as freshly verified — sets its frontmatter verified_at to now and ' +
      "verified_by to the CALLING user's email (never caller-supplied). Rewrites the page's " +
      'frontmatter block (creating one if it had none) and records a revision, same as any ' +
      'other content edit — including its conflict check, so a concurrent edit racing the ' +
      'stamp is rejected rather than reverted. Not allowed for viewers.',
    async handler(input, ctx) {
      const { slug } = input as { slug: string }
      return wikiService.verifyWikiPage(ctx, slug)
    },
    inputSchema: requiredObjectInputSchema(['slug'], {
      slug: describedInputProperty('string', 'Page ID or slug'),
    }),
    name: 'verify_wiki_page',
  },
  {
    annotations: READ,
    description:
      'Maintenance queue of wiki pages that need re-verification: computed-stale ' +
      '(verify_interval elapsed since verified_at), unverified (verify_interval declared but ' +
      'never verified), or explicitly status: stale|deprecated. Same rule search_wiki uses to ' +
      'demote results (R7).',
    async handler(input, ctx) {
      return wikiService.listStaleWikiPages(ctx, input)
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        ['projectId', describedInputProperty('string', 'Restrict to pages belonging to this project ID')],
        [
          'limit',
          fieldsInOrder([
            ['type', 'number'],
            ['default', DEFAULT_WIKI_MAINTENANCE_LIMIT],
          ]),
        ],
        [
          'offset',
          fieldsInOrder([
            ['type', 'number'],
            ['default', DEFAULT_WIKI_MAINTENANCE_OFFSET],
          ]),
        ],
        ['includeWorkspacePages', INCLUDE_WORKSPACE_PAGES_PROPERTY],
      ]),
    ),
    name: 'list_stale_pages',
  },
  {
    annotations: READ,
    description:
      'List pages flagged as templates (frontmatter `template: true`) — the picker ' +
      "create_wiki_page's `templateSlug` draws from. Templates are conventionally " +
      "workspace-global (living under a workspace 'Templates' page) but a project-scoped " +
      'template is allowed and follows the same project-visibility rule as any other ' +
      'project-scoped page.',
    async handler(input, ctx) {
      return wikiService.listWikiTemplates(ctx, input)
    },
    inputSchema: objectInputSchema({
      projectId: describedInputProperty('string', 'Restrict to templates belonging to this project ID'),
    }),
    name: 'list_wiki_templates',
  },
]
