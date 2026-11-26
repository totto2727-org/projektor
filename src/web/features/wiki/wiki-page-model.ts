import type { RenderedMarkdown } from '@/components/markdown/render.ts'

import type { Attachment } from './attachment-entry.tsx'
import type { WikiRevision } from './revisions-history.tsx'
import type { WikiFreshness } from './wiki-freshness-badge.tsx'

export interface ProjectOption {
  id: string
  key: string
  name: string
  workspace_slug: string
}
export interface WikiSeed {
  page: WikiPageData | null
  tree: TreeNode[]
  revisions: WikiRevision[]
  attachments: Attachment[]
  templates: TemplateOption[]
  projects: ProjectOption[]
  stalePages: StalePageItem[]
  filteredPages: WikiListItem[]
  searchResults: SearchResult[]
  draft: ServerDraft | null
  draftRevision?: string | null
  draftStatus: DraftStatus
  workspaceSlug: string
  projectId: string
  slug: string
  filterType: string
  filterStatus: string
  filterTags: string
  searchQuery: string
  createTitle: string
  mode: 'read' | 'create' | 'edit'
  publicViewer: boolean
  brandName: string
  /** Compiled in request scope so first server HTML includes body and hash targets. */
  renderedMarkdown?: RenderedMarkdown
}

// PROJ-491 (R9): the create-form's template picker draws from list_wiki_templates.
export interface TemplateOption {
  id: string
  slug: string
  title: string
}

export interface SearchResult {
  id: string
  slug: string
  title: string
  project_id: string | null
  excerpt: string | null
  // PROJ-488 (R6): denormalized frontmatter metadata, surfaced as chips in search results.
  type: string | null
  status: string | null
  tags: string[]
  /*
   * PROJ-489 (R7): search demotes stale/deprecated results — surfaced here so the UI
   * can show why a result ranks low.
   */
  freshness: WikiFreshness | null
}

export interface WikiPageData {
  id: string
  slug: string
  title: string
  content: string
  // PROJ-809: revision pointer for exactly this content (undefined from older servers).
  revisionId?: string | null
  project_id?: string | null
  parent_id: string | null
  updated_at: number
  // PROJ-488 (R6): optional YAML frontmatter, denormalized on the API side.
  type: string | null
  tags: string[]
  status: string | null
  verified_at: number | null
  verified_by: string | null
  owners: string[]
  verify_interval: number | null
  // PROJ-489 (R7): computed freshness, surfaced in the page header.
  freshness: WikiFreshness | null
}

// PROJ-489 (R7): the list_stale_pages maintenance queue shape.
export interface StalePageItem {
  id: string
  slug: string
  title: string
  freshness: WikiFreshness | null
}

/*
 * PROJ-488: shape returned by GET /api/wiki (listWikiPages) — used for the sidebar's
 * type/status/tags filtered browse view (WikiSidebar's flat list, distinct from the
 * hierarchical tree shown when no filter is active).
 */
export interface WikiListItem {
  id: string
  slug: string
  title: string
  type: string | null
  status: string | null
  tags: string[]
}

export interface TreeNode {
  id: string
  slug: string
  title: string
  type: string | null
  children: TreeNode[]
}

// PROJ-495 (R13): shape of a saved server-side draft (services/wiki-drafts.ts#getWikiDraft).
export interface ServerDraft {
  title: string
  content: string
  baseRevisionId: string | null
  updatedAt: number
  // PROJ-797 (client-only): the page was saved by someone since this draft started.
  pageChangedSince?: boolean
}

export type DraftStatus = 'loading' | 'ready' | 'failed'
