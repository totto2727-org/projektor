import { String, Predicate } from 'effect'

import * as wikiService from '#api/services/wiki.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'

import { CREATE, DESTRUCTIVE, PLAIN_WRITE } from './annotations.ts'
import { objectInputSchema, requiredObjectInputSchema } from './input-schema.ts'
import type { MCPTool } from './types.ts'
import { WELL_KNOWN_TYPES } from './wiki-tool-fields.ts'

export const wikiEditTools: MCPTool[] = [
  {
    name: 'create_wiki_page',
    description:
      'Create a new wiki page. `content` may start with an optional YAML frontmatter block ' +
      '(`---\\ntype: runbook\\ntags: [foo]\\nstatus: draft\\n---\\n...`) — type (freeform; ' +
      `well-known values ${WELL_KNOWN_TYPES}), tags[], status (draft|current|stale|` +
      'deprecated), verified_at, verified_by, owners[], verify_interval (days), template ' +
      '(boolean) are parsed and denormalised for filtering. Invalid frontmatter (bad status/' +
      'enum, wrong type, unrecognised key) is rejected with a structured error, not ignored. ' +
      'Alternatively, pass `templateSlug` (from ' +
      "list_wiki_templates) to seed this page's content from an existing template page — " +
      'its `template: true` flag is stripped from the seeded content (the new page is not ' +
      'itself a template). `templateSlug` and `content` are mutually exclusive; a ' +
      "`templateSlug` that doesn't resolve to a page flagged template:true is rejected.",
    inputSchema: requiredObjectInputSchema(['title'], {
      title: { type: 'string' },
      slug: {
        type: 'string',
        description: 'URL-safe identifier; auto-generated from title if omitted',
      },
      content: {
        type: 'string',
        description:
          'Markdown content, optionally starting with a YAML frontmatter block. ' +
          'Mutually exclusive with templateSlug.',
      },
      templateSlug: {
        type: 'string',
        description:
          "Seed this page's content from the template page at this slug/id (see " +
          'list_wiki_templates). Mutually exclusive with content.',
      },
      parentId: { type: 'string', description: 'Parent page ID for nested pages' },
      projectId: { type: 'string', description: 'Project ID to scope this page to' },
    }),
    annotations: CREATE,
    async handler(input, ctx) {
      return await wikiService.createWikiPage(ctx, input)
    },
  },
  {
    annotations: PLAIN_WRITE,
    description:
      'Update a wiki page by id or slug (saves a revision when content changes). Pass ' +
      'baseRevisionId (the current revision id from list_wiki_revisions/get_wiki_revision, ' +
      'or null if the page has never been revised) for conflict-safe writes: if the page ' +
      'advanced since baseRevisionId, the write is rejected with a structured conflict ' +
      '(currentRevisionId + a unified diff) instead of silently overwriting. Omitting ' +
      "baseRevisionId is DEPRECATED — it keeps today's last-write-wins behavior during the " +
      'transition and will be rejected in a future version. The revision pointer only ' +
      "advances on content edits, so baseRevisionId doesn't cover title/slug/parentId-only " +
      'changes; those are last-write-wins against writes that finished before your call, ' +
      'but any write that lands while your call is in flight returns a 409. `content` may include a YAML ' +
      "frontmatter block (see create_wiki_page); it's re-parsed on every content edit, " +
      "replacing the page's previously-stored metadata. Omitting `content` leaves the " +
      "page's existing frontmatter metadata unchanged.",
    async handler(input, ctx) {
      const { id, slug, newSlug, ...rest } = input as {
        id?: string
        slug?: string
        newSlug?: string
        title?: string
        content?: string
        parentId?: string | null
        baseRevisionId?: string | null
        summary?: string
      }
      const idOrSlug = id ?? slug
      if (Predicate.isNullish(idOrSlug) || String.isEmpty(idOrSlug)) {
        throw new ValidationError(validationIssues(['Either id or slug must be provided'], {}))
      }
      const payload = Predicate.isNotNullish(newSlug) ? { ...rest, slug: newSlug } : rest
      return await wikiService.updateWikiPage(ctx, idOrSlug, payload)
    },
    inputSchema: objectInputSchema({
      id: { type: 'string', description: 'Page ID' },
      slug: { type: 'string', description: 'Page slug (alternative to id)' },
      title: { type: 'string' },
      content: {
        type: 'string',
        description: 'Markdown content, optionally starting with a YAML frontmatter block',
      },
      parentId: {
        type: 'string',
        nullable: true,
        description: 'Parent page ID (null to unset parent, omit to leave unchanged)',
      },
      newSlug: {
        type: 'string',
        description: "Rename the page's slug; the old slug becomes a redirect so existing links keep resolving",
      },
      baseRevisionId: {
        type: ['string', 'null'],
        description:
          'Deprecated if omitted (see tool description). The revision id this edit is ' +
          'based on — null if the page has never been revised.',
      },
      summary: {
        type: 'string',
        description: 'Optional edit message/changelog note, recorded on the created revision',
      },
    }),
    name: 'update_wiki_page',
  },
  {
    annotations: PLAIN_WRITE,
    description:
      "Section-addressed patch operations on a wiki page's markdown, by id or slug. " +
      'Sections are addressed by exact heading text (a `#`..`######` line and everything ' +
      'up to the next heading; `#` lines inside fenced code blocks or the YAML ' +
      'frontmatter block are not headings). A heading that appears more than once on ' +
      'the page is ambiguous and rejected — patch targets must be unique. ' +
      'Ops: append_to_section (add text at the end of the ' +
      "section's body), replace_section (replace the section's body, heading kept), " +
      'insert_after_heading (insert text directly under the heading, before the ' +
      'existing body), append_to_page (append at the very end of the document, no ' +
      "heading needed), set_frontmatter (merge `values` into the page's YAML " +
      'frontmatter block without touching the rest of the content — a key set to ' +
      'null is removed; a page with no frontmatter block gains one). ' +
      'baseRevisionId is required (the current revision id from ' +
      'list_wiki_revisions/get_wiki_revision, or null if never revised) — conflict ' +
      'detection is SECTION-scoped, not whole-page: two agents patching different ' +
      "sections never conflict, even if the page's revision advanced between their " +
      'reads — only the SAME section changing underneath the caller conflicts ' +
      '(append_to_page and set_frontmatter skip this check; baseRevisionId is only ' +
      'validated as belonging to the page). A heading miss (never existed, or ' +
      "deleted/renamed since baseRevisionId) returns the page's current headings so " +
      'a caller can retry against reality. Creates a revision like update_wiki_page; ' +
      'ops other than set_frontmatter leave frontmatter metadata untouched beyond ' +
      'reparsing it (never stamps verified_at).',
    async handler(input, ctx) {
      const { id, slug, ...rest } = input as { id?: string; slug?: string }
      const idOrSlug = id ?? slug
      if (Predicate.isNullish(idOrSlug) || String.isEmpty(idOrSlug)) {
        throw new ValidationError(validationIssues(['Either id or slug must be provided'], {}))
      }
      return await wikiService.patchWikiPage(ctx, idOrSlug, rest)
    },
    inputSchema: requiredObjectInputSchema(['op', 'baseRevisionId'], {
      id: { type: 'string', description: 'Page ID' },
      slug: { type: 'string', description: 'Page slug (alternative to id)' },
      op: {
        type: 'string',
        enum: ['append_to_section', 'replace_section', 'insert_after_heading', 'append_to_page', 'set_frontmatter'],
      },
      heading: {
        type: 'string',
        description:
          "Target section's heading text (required for append_to_section, " + 'replace_section, insert_after_heading)',
      },
      text: {
        type: 'string',
        description: 'Text to add/replace (required for every op except set_frontmatter)',
      },
      values: {
        type: 'object',
        description:
          'set_frontmatter only: frontmatter keys to set (type, tags, status, ' +
          'verified_at, verified_by, owners, verify_interval, template). A key set ' +
          "to null is removed from the page's frontmatter.",
      },
      baseRevisionId: {
        type: ['string', 'null'],
        description: 'The revision id this patch is based on — null if the page has never been revised.',
      },
      summary: {
        type: 'string',
        description: 'Optional edit message/changelog note, recorded on the created revision',
      },
    }),
    name: 'patch_wiki_page',
  },
  {
    annotations: DESTRUCTIVE,
    description:
      'Delete a wiki page by slug (not allowed for viewers). By default any child pages are ' +
      "promoted to the deleted page's parent; pass cascade=true to delete the whole subtree instead.",
    async handler(input, ctx) {
      const { slug, cascade } = input as { slug: string; cascade?: boolean }
      return wikiService.deleteWikiPage(ctx, slug, { cascade })
    },
    inputSchema: requiredObjectInputSchema(['slug'], {
      slug: { type: 'string' },
      cascade: {
        type: 'boolean',
        default: false,
        description: 'Delete all descendant pages too, instead of promoting them',
      },
    }),
    name: 'delete_wiki_page',
  },
]
