import { Predicate, String } from 'effect'

import * as wikiWatchersService from '#api/services/wiki-watchers.ts'
import { ValidationError, validationIssues } from '#contracts/errors.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

import { PLAIN_WRITE, READ } from './annotations.ts'
import {
  isOmittedArgument,
  objectInputSchema,
  requiredObjectInputSchema,
  describedInputProperty,
} from './input-schema.ts'
import { capPage, toPage } from './serialize.ts'
import type { MCPTool } from './types.ts'

const DEFAULT_WIKI_NOTIFICATIONS_LIMIT = 50
const DEFAULT_WIKI_NOTIFICATIONS_OFFSET = 0
const DEFAULT_WIKI_CHANGES_LIMIT = 100

export const wikiWatchTools: MCPTool[] = [
  {
    annotations: PLAIN_WRITE,
    description:
      'Watch a wiki page by id or slug — its changes (create is n/a here since the page ' +
      'already exists, update/patch/verify/restore/delete) will generate a per-user ' +
      'notification (list_wiki_notifications). Pass subtree=true to also watch every ' +
      'page currently OR LATER nested under this one (resolved dynamically by walking ' +
      'the page hierarchy at notify time, not a one-time snapshot). Calling this again ' +
      'for the same page updates the subtree flag rather than creating a duplicate watch. ' +
      'Template pages (frontmatter template: true) never generate notifications even if ' +
      'watched directly or via a subtree.',
    async handler(input, ctx) {
      const { slug, ...rest } = input as { slug: string; subtree?: boolean }
      return wikiWatchersService.watchWikiPage(ctx, slug, rest)
    },
    inputSchema: requiredObjectInputSchema(['slug'], {
      slug: describedInputProperty('string', 'Page ID or slug'),
      subtree: fieldsInOrder([
        ['type', 'boolean'],
        ['default', false],
        ['description', "Also watch this page's current and future descendant pages"],
      ]),
    }),
    name: 'watch_wiki_page',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Stop watching a wiki page by id or slug (a no-op if not currently watched).',
    async handler(input, ctx) {
      const { slug } = input as { slug: string }
      return wikiWatchersService.unwatchWikiPage(ctx, slug)
    },
    inputSchema: requiredObjectInputSchema(['slug'], { slug: describedInputProperty('string', 'Page ID or slug') }),
    name: 'unwatch_wiki_page',
  },
  {
    annotations: READ,
    description: 'List the pages the calling user is currently watching.',
    async handler(_input, ctx) {
      return wikiWatchersService.listWikiWatches(ctx)
    },
    inputSchema: objectInputSchema({}),
    name: 'list_wiki_watches',
  },
  {
    annotations: READ,
    description:
      "List the calling user's wiki watch notifications (newest first). Each entry " +
      'records the page (denormalised slug/title, so a notification about a page ' +
      "that's since been deleted still shows what it was about), the action " +
      "(created|updated|deleted), the actor, and whether it's been read.",
    async handler(input, ctx) {
      return wikiWatchersService.listWikiNotifications(ctx, input)
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        [
          'unreadOnly',
          fieldsInOrder([
            ['type', 'boolean'],
            ['default', false],
          ]),
        ],
        [
          'limit',
          fieldsInOrder([
            ['type', 'number'],
            ['default', DEFAULT_WIKI_NOTIFICATIONS_LIMIT],
          ]),
        ],
        [
          'offset',
          fieldsInOrder([
            ['type', 'number'],
            ['default', DEFAULT_WIKI_NOTIFICATIONS_OFFSET],
          ]),
        ],
      ]),
    ),
    name: 'list_wiki_notifications',
  },
  {
    annotations: PLAIN_WRITE,
    description: 'Mark wiki notifications as read, by id, or all: true for every unread one.',
    async handler(input, ctx) {
      return wikiWatchersService.markWikiNotificationsRead(ctx, input)
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        [
          'ids',
          fieldsInOrder([
            ['type', 'array'],
            ['items', { type: 'string' }],
            ['description', 'Notification IDs to mark read'],
          ]),
        ],
        [
          'all',
          fieldsInOrder([
            ['type', 'boolean'],
            ['default', false],
            ['description', "Mark all of the caller's notifications read"],
          ]),
        ],
      ]),
    ),
    name: 'mark_wiki_notifications_read',
  },
  {
    annotations: READ,
    description:
      'Cheap delta feed of wiki page changes since a unix-seconds timestamp — for agents ' +
      "polling 'what changed' instead of re-fetching/re-searching the whole wiki. " +
      '`since` is EXCLUSIVE; ' +
      "poll again passing the response's `next` as `cursor`, not a locally-computed timestamp, so " +
      'changes landing on the same second as the cutoff are never missed or double-' +
      'delivered. Defaults to every wiki page the caller can see (same visibility as ' +
      'list_wiki_pages/search_wiki) — pass watchedOnly=true to narrow to pages the caller ' +
      "is watching (directly or via a subtree watch). A `deleted` entry's slug/title/" +
      'projectId reflect the page as it was just before deletion (the row itself is gone).',
    async handler(input, ctx) {
      const { cursor, ...rest } = (input ?? {}) as Record<string, unknown>
      // Null / "" mean "no cursor", not "since the epoch".
      if (Predicate.isNotNullish(cursor) && !(Predicate.isString(cursor) && String.isEmpty(cursor))) {
        rest.since = Number(cursor)
      }
      if (isOmittedArgument(rest.since) || Number.isNaN(rest.since)) {
        throw new ValidationError(
          validationIssues([], { since: ['pass since (unix seconds) or cursor from a previous `next`'] }),
        )
      }
      const result = await wikiWatchersService.listWikiChanges(ctx, rest)
      /*
       * `next` is present whenever the cursor moved (even if every row in the batch was filtered
       * out, so a poller keeps advancing); the feed is drained when it is absent.
       */
      const events = result.changes as { createdAt: number }[]
      const page = toPage(events, result.nextSince > (rest.since as number) ? result.nextSince : undefined)
      // `since` is exclusive, so a cut must not split events sharing one second.
      return capPage(
        page,
        fieldsInOrder([
          ['cursorOf', (index: number) => globalThis.String(events[index].createdAt)],
          ['canCutAt', (kept: number) => events[kept - 1].createdAt !== events[kept]?.createdAt],
        ]),
      )
    },
    inputSchema: objectInputSchema(
      fieldsInOrder([
        ['since', describedInputProperty('number', 'Unix seconds; only changes strictly after this are returned')],
        ['cursor', describedInputProperty('string', "Pass the previous page's `next` unchanged (replaces `since`)")],
        [
          'limit',
          fieldsInOrder([
            ['type', 'number'],
            ['default', DEFAULT_WIKI_CHANGES_LIMIT],
          ]),
        ],
        ['projectId', describedInputProperty('string', 'Restrict to changes on pages in this project')],
        [
          'watchedOnly',
          fieldsInOrder([
            ['type', 'boolean'],
            ['default', false],
            ['description', 'Restrict to pages the caller is watching (directly or via subtree)'],
          ]),
        ],
      ]),
    ),
    name: 'list_wiki_changes',
  },
]
