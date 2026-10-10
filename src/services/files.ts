import type { Effect } from 'effect'

import { type DataQueryError, queryEffect } from './errors'

/** Trusted app-authored predicates, never request input. Aliases: a attachment, w linked page. */
export interface AttachmentVisibility {
  sql: string
  params: readonly unknown[]
}
export interface AttachmentQueryOptions {
  ownerVisibility?: AttachmentVisibility | null
  linkedWikiVisibility?: AttachmentVisibility | null
}
export interface AttachmentListOptions extends AttachmentQueryOptions {
  entityType: 'issue' | 'wiki_page'
  entityId: string
}
export interface AttachmentMetadata {
  id: string
  kind: 'file' | 'wiki_ref' | 'url'
  filename: string
  contentType: string
  size: number
  url: string | null
  createdAt: number
  wikiPage: {
    id: string
    title: string | null
    slug: string | null
    projectId: string | null
  } | null
}
interface AttachmentRow {
  id: string
  kind: AttachmentMetadata['kind']
  filename: string
  content_type: string
  size: number
  url: string | null
  created_at: number
  wiki_page_id: string | null
  wiki_page_slug: string | null
  wiki_page_title: string | null
  wiki_page_project_id: string | null
}
function toMetadata(row: AttachmentRow): AttachmentMetadata {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    url: row.url,
    createdAt: row.created_at,
    wikiPage:
      row.kind === 'wiki_ref' && row.wiki_page_id
        ? {
            id: row.wiki_page_id,
            title: row.wiki_page_title,
            slug: row.wiki_page_slug,
            projectId: row.wiki_page_project_id,
          }
        : null,
  }
}
function metadataQuery(
  db: D1Database,
  workspaceId: string,
  filter: string,
  values: unknown[],
  options: AttachmentQueryOptions,
) {
  const linked = options.linkedWikiVisibility
  const owner = options.ownerVisibility
  return db
    .prepare(`SELECT a.id, a.kind, a.filename, a.content_type, a.size, a.url, a.created_at,
		w.id AS wiki_page_id, w.slug AS wiki_page_slug, w.title AS wiki_page_title,
		w.project_id AS wiki_page_project_id
		FROM attachments a LEFT JOIN wiki_pages w
		ON w.id = a.linked_wiki_page_id AND w.workspace_id = a.workspace_id AND w.deleted_at IS NULL
		${linked ? `AND (w.project_id IS NULL OR ${linked.sql})` : ''}
		WHERE a.workspace_id = ? AND ${filter} ${owner ? `AND (${owner.sql})` : ''}
		ORDER BY a.created_at ASC`)
    .bind(...(linked?.params ?? []), workspaceId, ...values, ...(owner?.params ?? []))
}
/** The caller supplies policy predicates. The query always retains tenant and entity scope. */
export function listAttachments(
  db: D1Database,
  workspaceId: string,
  options: AttachmentListOptions,
): Effect.Effect<AttachmentMetadata[], DataQueryError> {
  return queryEffect('listAttachments', async () => {
    const rows = await metadataQuery(
      db,
      workspaceId,
      'a.entity_type = ? AND a.entity_id = ?',
      [options.entityType, options.entityId],
      options,
    ).all<AttachmentRow>()
    return (rows.results ?? []).map(toMetadata)
  })
}
export function findAttachment(
  db: D1Database,
  workspaceId: string,
  id: string,
  options: AttachmentQueryOptions = {},
): Effect.Effect<AttachmentMetadata | null, DataQueryError> {
  return queryEffect('findAttachment', async () => {
    const row = await metadataQuery(db, workspaceId, 'a.id = ?', [id], options).first<AttachmentRow>()
    return row ? toMetadata(row) : null
  })
}
