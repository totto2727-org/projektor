import { WIKI_WELL_KNOWN_TYPES } from '#contracts/inputs/wiki.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'

/*
 * PROJ-513: `type` is freeform — these are advertised as hints, never as an
 * inputSchema `enum` (which clients treat as the only legal values).
 */
export const WELL_KNOWN_TYPES = WIKI_WELL_KNOWN_TYPES.join('|')
export const TYPE_FILTER_DESCRIPTION =
  'Filter to pages whose frontmatter `type` matches (freeform; well-known ' + `values are ${WELL_KNOWN_TYPES})`
export const INCLUDE_WORKSPACE_PAGES_PROPERTY = fieldsInOrder([
  ['type', 'boolean' as const],
  [
    'description',
    'When a projectId is given, also return workspace-level pages (those belonging to ' +
      "no project). Default false — the projectId filter alone returns that project's " +
      'pages only.',
  ],
])
