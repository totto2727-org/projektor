import { Predicate } from 'effect'

import * as wikiService from '#api/services/wiki.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'
import { isNonEmptyText } from '#contracts/non-empty-text.ts'

import { READ } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema, describedInputProperty } from './input-schema.ts'
import { capPage, toPage } from './serialize.ts'
import type { MCPTool } from './types.ts'
import { TYPE_FILTER_DESCRIPTION, INCLUDE_WORKSPACE_PAGES_PROPERTY } from './wiki-tool-fields.ts'
import { outlineOf, sectionOf, WIKI_DEFAULT_MAX_CHARS, WIKI_MAX_CHARS, windowText } from './windowing.ts'

export const wikiReadTools: MCPTool[] = [
  {
    annotations: READ,
    description:
      'List wiki pages in the workspace, optionally filtered by parent, project, ' +
      'frontmatter type/status, or tags (any-of match)',
    async handler(input, ctx) {
      return wikiService.listWikiPages(ctx, input)
    },
    inputSchema: objectInputSchema({
      parentId: describedInputProperty('string', 'Filter to children of this page ID'),
      projectId: describedInputProperty('string', 'Filter to pages belonging to this project ID'),
      type: describedInputProperty('string', TYPE_FILTER_DESCRIPTION),
      status: {
        type: 'string',
        enum: ['draft', 'current', 'stale', 'deprecated'],
        description: 'Filter to pages whose frontmatter `status` matches',
      },
      tags: {
        type: ['array', 'string'],
        items: { type: 'string' },
        description:
          'Filter to pages carrying at least one of these frontmatter tags (array, or a comma-separated string)',
      },
      includeTemplates: {
        type: 'boolean',
        default: false,
        description:
          'Include template pages in the results (default false, matching search_wiki/' +
          'list_stale_pages). Use list_wiki_templates for the template-picker use case instead.',
      },
      includeWorkspacePages: INCLUDE_WORKSPACE_PAGES_PROPERTY,
    }),
    name: 'list_wiki_pages',
  },
  {
    annotations: READ,
    description:
      'Full-text search over wiki pages (FTS5, BM25-ranked, title weighted above body). ' +
      'Returns match-anchored snippets highlighted with ** markers, plus a computed ' +
      '`freshness` ({state, staleSince} or null if the page has no verify_interval/status ' +
      'signal) per result. type/status/tags filter on the denormalised frontmatter columns ' +
      '(R6). Results are demoted (ranked below everything else, ties broken by bm25 within ' +
      'each tier) when the page is computed-stale/unverified OR has an explicit ' +
      'status: stale|deprecated (R7). Returns `{items, next?}` — pass `next` back as `cursor`. ' +
      'See /projektor/agents/response-conventions/.',
    async handler(input, ctx) {
      const { cursor, ...rest } = (input ?? {}) as Record<string, unknown>
      if (cursor !== undefined) {
        const offset = Number(cursor)
        if (!Number.isInteger(offset) || offset < 0) {
          throw new ValidationError(validationIssues([], { cursor: ['invalid cursor'] }))
        }
        rest.offset = offset
      }
      const items = (await wikiService.searchWiki(ctx, rest)) as unknown[]
      // A full page means there may be more: the cursor is the next offset.
      const limit = Predicate.isNumber(rest.limit) ? rest.limit : 10
      const offset = Predicate.isNumber(rest.offset) ? rest.offset : 0
      const page = toPage(items, items.length >= limit ? offset + limit : null)
      // A cut page resumes at the first dropped result.
      return capPage(page, { cursorOf: (index) => globalThis.String(offset + index + 1) })
    },
    inputSchema: requiredObjectInputSchema(['query'], {
      query: { type: 'string' },
      limit: { type: 'number', default: 10 },
      offset: { type: 'number', default: 0 },
      cursor: describedInputProperty('string', "Pass the previous page's `next` unchanged (replaces offset)"),
      projectId: describedInputProperty('string', 'Restrict search to this project ID'),
      updatedSince: describedInputProperty('number', 'Unix seconds — only return pages updated at or after this time'),
      type: describedInputProperty('string', TYPE_FILTER_DESCRIPTION),
      tags: {
        type: ['array', 'string'],
        items: { type: 'string' },
        description:
          'Filter to pages carrying at least one of these frontmatter tags (array, or a comma-separated string)',
      },
      status: {
        type: 'string',
        enum: ['draft', 'current', 'stale', 'deprecated'],
        description: 'Filter to pages whose frontmatter `status` matches',
      },
      includeWorkspacePages: INCLUDE_WORKSPACE_PAGES_PROPERTY,
    }),
    name: 'search_wiki',
  },
  {
    annotations: READ,
    description:
      'Get a wiki page by slug. Long pages are windowed: `content` is at most `maxChars` ' +
      '(default 8000, max 20000) and `totalChars` is the full length; when `next` is present pass it ' +
      "back as `cursor` for the following window. `outline` lists the page's headings — pass " +
      "`section` (a heading's text or slug) to read just that section. Pass the returned " +
      '`revisionId` as `baseRevisionId` when you update or patch the page. ' +
      '`contentTruncated:true` means `content` is only part of the page: NEVER pass it back to ' +
      'update_wiki_page (that would overwrite the page with the fragment) — use patch_wiki_page. ' +
      'See /projektor/agents/response-conventions/.',
    async handler(input, ctx) {
      const { slug, maxChars, cursor, section } = input as {
        slug: string
        maxChars?: number
        cursor?: string
        section?: string
      }
      const max = maxChars ?? WIKI_DEFAULT_MAX_CHARS
      if (!Number.isInteger(max) || max < 1 || max > WIKI_MAX_CHARS) {
        throw new ValidationError(
          validationIssues([], { maxChars: [`must be an integer from 1 to ${WIKI_MAX_CHARS}`] }),
        )
      }
      const page = await wikiService.getWikiPage(ctx, slug)
      const full = page.content ?? ''
      const outline = outlineOf(full)
      const { content: _full, ...rest } = page
      if (Predicate.isNotNullish(section)) {
        const body = sectionOf(full, section)
        // A miss is not an error: the outline says what sections exist.
        if (Predicate.isNullish(body)) {
          return { ...rest, outline, section, sectionFound: false }
        }
        const sectionWindow = windowText(body, { cursor, max })
        return {
          ...rest,
          outline,
          section,
          content: sectionWindow.text,
          totalChars: sectionWindow.totalChars,
          contentTruncated: true,
          ...(isNonEmptyText(sectionWindow.next) ? { next: sectionWindow.next } : {}),
        }
      }
      const contentWindow = windowText(full, { cursor, max })
      return {
        ...rest,
        outline,
        content: contentWindow.text,
        totalChars: contentWindow.totalChars,
        ...(isNonEmptyText(contentWindow.next) || Predicate.isNotNullish(cursor) ? { contentTruncated: true } : {}),
        ...(isNonEmptyText(contentWindow.next) ? { next: contentWindow.next } : {}),
      }
    },
    inputSchema: requiredObjectInputSchema(['slug'], {
      slug: { type: 'string' },
      maxChars: {
        type: 'number',
        default: WIKI_DEFAULT_MAX_CHARS,
        description: `Max characters of content per call (1-${WIKI_MAX_CHARS})`,
      },
      cursor: describedInputProperty('string', "Pass the previous window's `next` unchanged"),
      section: describedInputProperty('string', "Return only this section (a heading's text or slug, from `outline`)"),
    }),
    name: 'get_wiki_page',
  },
]
