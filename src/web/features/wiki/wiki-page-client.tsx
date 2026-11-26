'use client'

import { query } from '@effront/core/query'
import { useForm, useStore } from '@tanstack/react-form'
import { String, Array, Iterable, Predicate, Effect, Schema } from 'effect'
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'

import { HTTP_CONFLICT } from '#contracts/http-status.ts'
import { hasMultipleItems } from '#contracts/item-count.ts'
import { currentEpochSeconds } from '#contracts/time.ts'
import { isWikiRevisionSpecified } from '#contracts/wiki-revision.ts'
import { uploadInlineImage as uploadEditorImage } from '@/attachment-actions.ts'
import { FunctionError, unwrapResult } from '@/client/functions.ts'
import { useMarkdownPreview } from '@/components/markdown/markdown-preview.tsx'
import type { RenderedMarkdown } from '@/components/markdown/render.ts'
import { Button } from '@/components/ui/button.tsx'
import { Popover } from '@/components/ui/popover.tsx'
import { Select } from '@/components/ui/select.tsx'
import type { SelectOption } from '@/components/ui/select.tsx'
import { formatTimestamp } from '@/features/timestamp.ts'

import {
  createWikiPage,
  deleteWikiAttachment,
  duplicateWikiPage,
  getWikiDraftState,
  getWikiPage,
  moveWikiPage,
  restoreTrashedWikiPage,
  restoreWikiRevision,
  trashWikiPage,
  verifyWikiPage,
} from './actions.ts'
import type { Attachment } from './attachment-entry.tsx'
import { AttachmentsPanel } from './attachments-panel.tsx'
import { CreateFields, EditFields, FilterFields, MoveFields, SearchFields } from './form-schemas.ts'
import { LazyMarkdownEditor as MarkdownEditor } from './lazy-markdown-editor.tsx'
import { navigateFeature } from './navigation.ts'
import { stripFrontmatter } from './render-markdown.ts'
import { RevisionsHistory } from './revisions-history.tsx'
import type { WikiRevision } from './revisions-history.tsx'
import { useServerDraftAutosave } from './wiki-draft-autosave.ts'
import { differsFromPublished } from './wiki-draft-lifecycle.ts'
import { wikiHref } from './wiki-href.ts'
import { WikiMetadataCard } from './wiki-metadata-card.tsx'
import type {
  DraftStatus,
  SearchResult,
  ServerDraft,
  TemplateOption,
  TreeNode,
  WikiPageData,
  WikiSeed,
} from './wiki-page-model.ts'
import { SeedContext, usePublicViewer, useWikiSeed } from './wiki-seed-context.ts'
import { useIsMobileViewport, useWikiSidebarDrawer } from './wiki-sidebar-drawer.ts'
import { WikiSidebar } from './wiki-sidebar.tsx'

const FIRST_INNER_BREADCRUMB = 1
const LAST_BREADCRUMB_SLICE_END = -1
const LAST_INDEX_OFFSET = 1
const FIRST_HEADING_LEVEL = 1
const TOC_PADDING_PER_LEVEL_REM = 0.75
const TOC_BASE_PADDING_REM = 0.5
const PAGE_MENU_VERTICAL_GAP_PX = 4
const PAGE_MENU_MIN_RIGHT_PX = 8
const MENU_NEXT_ITEM_OFFSET = 1
const MENU_PREVIOUS_ITEM_OFFSET = -1
const INITIAL_CONTENT_MOUNT_TOKEN = 0
const CONTENT_MOUNT_TOKEN_STEP = 1
const EXCERPT_START = 0
const MIN_TOC_ENTRIES = 3
const HASH_CONTENT_START = 1
const INITIAL_EDIT_VERSION = 0
const INITIAL_EDIT_SESSION = 0

/*
 * PROJ-804: pure and exported so it's unit-testable without mounting WikiPage. Turns
 * heading text into a URL-safe id and de-duplicates within one pass over the page's
 * headings — repeated text (two "Overview" headings) gets `-1`, `-2`, … suffixes
 * instead of two headings sharing an id (which broke the second TOC entry's link and
 * its React/Preact list key). A heading whose text produces an empty slug (e.g. all
 * punctuation, or a script `[^a-z0-9]` strips entirely) falls back to `section-N`
 * (1-based, N = that heading's position) rather than `id=""`.
 *
 * Uniqueness is checked against every id handed out so far, not a per-base counter:
 * ["Overview", "Overview", "Overview 1"] must not give `overview-1` twice, so a suffix
 * is only taken once it's actually free. An id the author wrote (`<h2 id="install">`,
 * which DOMPurify keeps) is reserved up front and left as-is — links elsewhere point
 * at it — and generated ids steer around it. Only a *repeated* authored id is
 * re-suffixed, since two elements can't share it either. Because kept ids are left
 * alone, running this again over headings it already labelled is a no-op.
 */
export { assignHeadingIds } from './headings.ts'
export type { DraftStatus, ServerDraft, WikiPageData, WikiSeed } from './wiki-page-model.ts'

const slugify = function slugify(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-|-$/gu, '')
}
const safeDecodeURIComponent = function safeDecodeURIComponent(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}
const undeleteWikiPage = async function undeleteWikiPage(
  id: string,
  workspaceSlug?: string,
): Promise<{ slug: string }> {
  return unwrapResult(await restoreTrashedWikiPage({ pageId: id, workspaceSlug }))
}

const WIKI_TYPE_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All types' },
  { value: 'runbook', label: 'Runbook' },
  { value: 'adr', label: 'ADR' },
  { value: 'spec', label: 'Spec' },
  { value: 'note', label: 'Note' },
]

const WIKI_WELL_KNOWN_TYPES = new Set(WIKI_TYPE_FILTER_OPTIONS.map((option) => option.value).filter(Boolean))

/*
 * PROJ-514: frontmatter `type` is freeform (PROJ-513) — merge in any other distinct
 * types actually present in the workspace so pages using e.g. `type: whitepaper` stay
 * discoverable, without losing the well-known values' friendly labels/ordering. Dedupe
 * case-insensitively (frontmatter `type` is never case-normalized) so e.g. `Runbook`
 * doesn't produce a second, visually-indistinguishable entry alongside the well-known
 * lowercase `runbook`.
 */
const buildTypeFilterOptions = function buildTypeFilterOptions(discoveredTypes: Readonly<string[]>): SelectOption[] {
  const seen = new Set(globalThis.Array.from(WIKI_WELL_KNOWN_TYPES).map((wikiType) => wikiType.toLowerCase()))
  const extras: string[] = []
  Iterable.forEach(discoveredTypes, (wikiType) => {
    if (!wikiType) {
      return
    }
    const key = wikiType.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    extras.push(wikiType)
  })
  extras.sort((left, right) => left.localeCompare(right))
  return [...WIKI_TYPE_FILTER_OPTIONS, ...extras.map((wikiType) => ({ value: wikiType, label: wikiType }))]
}

interface FlatEntry {
  id: string
  slug: string
  title: string
  parentId: string | null
}

interface TocItem {
  level: number
  text: string
  id: string
}

// PROJ-807: state for the "page moved to trash" toast shown after a delete, with an
// Undo action wired to the existing trash-undelete endpoint.
interface UndoToast {
  id: string
  message: string
  /** The undo itself. Only a rejection here is reported as "Undo failed". */
  undo: () => Promise<string>
  /**
   * Best-effort follow-up once `undo` has succeeded (refresh the tree, go back to the
   * page), given what `undo` resolved to. Its failures are swallowed: the page is
   * already restored, so "Undo failed" would be false.
   */
  afterUndo?: (result: string) => void | Promise<void>
}

interface Props {
  workspaceSlug?: string
  projectId?: string
  slug?: string
}

/*
 * PROJ-514: walks the tree already fetched by useWikiTree to discover distinct `type`
 * values for the sidebar filter dropdown, instead of issuing a second unfiltered fetch.
 */
const collectTreeTypes = function collectTreeTypes(nodes: Readonly<TreeNode[]>): string[] {
  const types: string[] = []
  Iterable.forEach(nodes, (node) => {
    if (node.type) {
      types.push(node.type)
    }
    types.push(...collectTreeTypes(node.children))
  })
  return types
}

const flattenTree = function flattenTree(
  nodes: Readonly<TreeNode[]>,
  parentId: string | null = null,
): Record<string, FlatEntry> {
  const map: Record<string, FlatEntry> = {}
  Iterable.forEach(nodes, (node) => {
    map[node.id] = { id: node.id, slug: node.slug, title: node.title, parentId }
    const childMap = flattenTree(node.children, node.id)
    Iterable.forEach(Object.entries(childMap), ([childId, child]) => {
      map[childId] = child
    })
  })
  return map
}

const getBreadcrumbs = function getBreadcrumbs(pageId: string, map: Record<string, FlatEntry>): FlatEntry[] {
  const crumbs: FlatEntry[] = []
  let cur: FlatEntry | undefined = map[pageId]
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    crumbs.unshift(cur)
    cur = cur.parentId ? map[cur.parentId] : undefined
  }
  return crumbs
}
function useWikiTemplates(_workspaceSlug: string | undefined): TemplateOption[] {
  return useWikiSeed().templates
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function CreatePageForm({
  parentTitle,
  title,
  slug,
  content,
  error,
  saving,
  templates,
  templateSlug,
  onTitleChange,
  onSlugChange,
  onContentChange,
  onTemplateChange,
  onSubmit,
  onCancel,
}: {
  parentTitle: string | null
  title: string
  slug: string
  content: string
  error: string | undefined
  saving: boolean
  templates: TemplateOption[]
  templateSlug: string
  onTitleChange: (value: string) => void
  onSlugChange: (value: string) => void
  onContentChange: (value: string) => void
  onTemplateChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}): JSX.Element {
  const templateOptions: SelectOption[] = [
    { value: '', label: 'No template (blank page)' },
    ...templates.map((template) => ({ value: template.slug, label: template.title })),
  ]
  const selectedTemplate = templates.find((template) => template.slug === templateSlug) ?? null

  return (
    <div>
      <h2 className='mb-6 text-2xl font-bold text-text-base'>
        {Predicate.isNotNullish(parentTitle) && String.isNonEmpty(parentTitle)
          ? `New child page under "${parentTitle}"`
          : 'New page'}
      </h2>
      {error && (
        <p role='alert' className='text-danger-text mb-3'>
          {error}
        </p>
      )}
      <div className='mb-4'>
        <label htmlFor='create-title' className='block font-medium text-sm text-text-base mb-1'>
          Title <span className='text-danger-text'>*</span>
        </label>
        <input
          id='create-title'
          type='text'
          value={title}
          onChange={(event) => {
            onTitleChange(event.target.value)
          }}
          placeholder='Page title'
          className='w-full px-3 py-2 border border-border rounded text-sm bg-bg text-text-base box-border text-base'
        />
      </div>
      <div className='mb-4'>
        <label htmlFor='create-slug' className='block font-medium text-sm text-text-base mb-1'>
          Slug
        </label>
        <input
          id='create-slug'
          type='text'
          value={slug}
          onChange={(event) => {
            onSlugChange(event.target.value)
          }}
          placeholder='auto-derived-from-title'
          className='w-full px-3 py-2 border border-border rounded text-sm bg-bg text-text-base box-border font-mono'
        />
      </div>
      {Array.isArrayNonEmpty(templates) && (
        <div className='mb-4'>
          <p className='m-0 mb-1 font-medium text-sm text-text-base'>Template</p>
          <Select
            value={templateSlug}
            options={templateOptions}
            ariaLabel='Seed content from template'
            onChange={onTemplateChange}
          />
        </div>
      )}
      <div className='mb-5'>
        {selectedTemplate ? (
          <p className='text-sm text-text-muted'>
            Content will be seeded from the "{selectedTemplate.title}" template on create.
          </p>
        ) : (
          <>
            {/* Caption for MarkdownEditor, which has no associable control */}
            <label className='block font-medium text-sm text-text-base mb-1'>Content (Markdown)</label>
            <MarkdownEditor value={content} onChange={onContentChange} minHeight='280px' />
          </>
        )}
      </div>
      <div className='flex gap-2'>
        <Button variant='primary' onClick={onSubmit} disabled={saving}>
          {saving ? 'Creating…' : 'Create page'}
        </Button>
        <Button variant='outline' onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

const BREADCRUMB_BUTTON_CLASS = [
  'bg-transparent border-none cursor-pointer text-text-muted text-[0.8rem] p-0',
  'underline decoration-transparent hover:text-accent hover:decoration-accent',
].join(' ')

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function PageBreadcrumbs({
  breadcrumbs,
  onNavigate,
}: {
  breadcrumbs: FlatEntry[]
  onNavigate: (slug: string) => void
}): undefined | JSX.Element {
  if (!hasMultipleItems(breadcrumbs)) {
    return undefined
  }
  return (
    <nav
      className='wiki-breadcrumb text-[0.8rem] text-text-muted mb-3 flex flex-wrap gap-1 items-center'
      aria-label='Breadcrumb'
    >
      <button
        type='button'
        className={BREADCRUMB_BUTTON_CLASS}
        onClick={() => {
          onNavigate(breadcrumbs[0].slug)
        }}
      >
        Home
      </button>
      {breadcrumbs.slice(FIRST_INNER_BREADCRUMB, LAST_BREADCRUMB_SLICE_END).map((crumb) => (
        /*
         * PROJ-806: the key belongs on the list item itself (this fragment), not a
         * DOM node nested inside it — Preact reconciles the fragment's children by
         * their position, not the key on a descendant, so a key here (rather than on
         * the button) is what actually makes each breadcrumb crumb identifiable
         * across re-renders when the list changes.
         */
        <Fragment key={crumb.id}>
          <span>›</span>
          <button
            type='button'
            className={BREADCRUMB_BUTTON_CLASS}
            onClick={() => {
              onNavigate(crumb.slug)
            }}
          >
            {crumb.title}
          </button>
        </Fragment>
      ))}
      <span>›</span>
      <span className='text-text-base'>{breadcrumbs[breadcrumbs.length - LAST_INDEX_OFFSET].title}</span>
    </nav>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function MovePageForm({
  options,
  value,
  saving,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  options: SelectOption[]
  value: string
  saving: boolean
  error: string | undefined
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className='mb-4 p-3 border border-border rounded bg-surface'>
      <p className='m-0 mb-2 text-sm font-medium text-text-base'>Move to a new parent page</p>
      {error && (
        <p role='alert' className='text-danger-text mb-2 text-sm'>
          {error}
        </p>
      )}
      <div className='flex flex-wrap gap-2 items-center'>
        <div className='min-w-[220px]'>
          <Select value={value} options={options} ariaLabel='New parent page' onChange={onChange} />
        </div>
        <Button variant='primary' size='sm' onClick={onSubmit} disabled={saving}>
          {saving ? 'Moving…' : 'Move'}
        </Button>
        <Button variant='outline' size='sm' onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

const TOC_LINK_BASE_CLASS = 'block py-[0.2rem] no-underline border-l-2 transition-[color,border-color] duration-150'
const TOC_LINK_ACTIVE_CLASS = 'text-accent border-accent font-medium'
const TOC_LINK_INACTIVE_CLASS = 'text-text-muted border-border hover:text-accent hover:border-accent'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function TocList({
  toc,
  activeHeadingId,
  onClick,
}: {
  toc: TocItem[]
  activeHeadingId: string
  onClick?: () => void
}): JSX.Element {
  return (
    <>
      {toc.map((item) => {
        const isTocActive = activeHeadingId === item.id
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`${TOC_LINK_BASE_CLASS} ${isTocActive ? TOC_LINK_ACTIVE_CLASS : TOC_LINK_INACTIVE_CLASS}`}
            style={{
              paddingLeft: `${(item.level - FIRST_HEADING_LEVEL) * TOC_PADDING_PER_LEVEL_REM + TOC_BASE_PADDING_REM}rem`,
            }}
            onClick={onClick}
          >
            {item.text}
          </a>
        )
      })}
    </>
  )
}

/*
 * PROJ-664: on mobile the [+ Child page]/[Move]/[Delete] buttons that used to
 * sit inline (326px, shrink-0, no scrolling ancestor) pushed scrollWidth past
 * the viewport and crushed the title. Below 640px only Edit stays inline;
 * the rest move behind this menu. Mirrors AccountMenu's trigger+Popover shape.
 */
function useDuplicateWikiPage() {
  const seed = useWikiSeed()
  const [duplicating, setDuplicating] = useState(false)
  const duplicate = async function duplicate(): Promise<void> {
    if (!seed.page || duplicating) {
      return
    }
    setDuplicating(true)
    try {
      const copy = unwrapResult(await duplicateWikiPage({ workspaceSlug: seed.workspaceSlug, slug: seed.page.slug }))
      navigateFeature(wikiHref(seed, `/wiki/${encodeURIComponent(copy.slug)}`))
    } catch (error) {
      window.alert(`Could not duplicate page: ${globalThis.String(error)}`)
    }
    setDuplicating(false)
  }
  return { duplicate, duplicating }
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function PageActionOverflowMenu({
  pageId,
  onStartCreateChild,
  onStartMove,
  onDelete,
}: {
  pageId: string
  onStartCreateChild: (pageId: string) => void
  onStartMove: () => void
  onDelete: () => void
}): JSX.Element {
  const { duplicate, duplicating } = useDuplicateWikiPage()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number }>()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const isInside = useCallback((node: Node) => {
    return rootRef.current?.contains(node) === true || popoverRef.current?.contains(node) === true
  }, [])

  const openMenu = function openMenu(): void {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setPos({
        top: rect.bottom + PAGE_MENU_VERTICAL_GAP_PX,
        right: Math.max(PAGE_MENU_MIN_RIGHT_PX, window.innerWidth - rect.right),
      })
    }
    setOpen(true)
  }

  const menuItems = useCallback((): HTMLElement[] => {
    return globalThis.Array.from(popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  }, [])

  const closeToTrigger = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  /*
   * PROJ-806: a menu that opens without moving focus into itself, or that doesn't
   * support arrow keys, forces a screen reader or keyboard user to tab through the
   * rest of the page to reach it. Focus moves to the first item on open; ArrowUp/
   * ArrowDown cycle between items (wrapping), matching the standard menu pattern. The
   * items are tabindex=-1 (arrows move between them, not Tab), and Tab or Escape close
   * the menu back to its trigger — the menu is portalled to <body>, so letting Tab run
   * on would jump to wherever the portal sits in the document, not the next control
   * after ⋯.
   */
  useEffect(() => {
    if (!open) {
      return
    }
    menuItems()[0]?.focus()
    const onPointerDown = function onPointerDown(event: MouseEvent): void {
      if (!(event.target instanceof Node) || !isInside(event.target)) {
        setOpen(false)
      }
    }
    const onKeyDown = function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault()
        closeToTrigger()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return
      }
      const items = menuItems()
      if (Array.isArrayEmpty(items)) {
        return
      }
      event.preventDefault()
      const currentIndex = items.indexOf(document.activeElement as HTMLElement)
      const delta = event.key === 'ArrowDown' ? MENU_NEXT_ITEM_OFFSET : MENU_PREVIOUS_ITEM_OFFSET
      const nextIndex = (currentIndex + delta + items.length) % items.length
      items[nextIndex]?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, menuItems, isInside, closeToTrigger])

  /*
   * Refocus the trigger *before* running the action: the menu (and the focused item)
   * is about to unmount, which would otherwise drop focus to <body>. An action that
   * moves focus somewhere deliberately still gets the last word.
   */
  const runAndClose = function runAndClose(fn: () => void): void {
    closeToTrigger()
    fn()
  }

  return (
    <div className='relative' ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        className='btn btn-outline btn-sm'
        aria-haspopup='menu'
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label='More page actions'
        onClick={() => {
          if (open) {
            setOpen(false)
          } else {
            openMenu()
          }
        }}
      >
        ⋯
      </button>
      {open && pos && (
        <Popover
          id={menuId}
          role='menu'
          ariaLabel='More page actions'
          strategy='portal-fixed'
          elementRef={popoverRef}
          position={pos}
        >
          <button
            type='button'
            role='menuitem'
            tabIndex={-1}
            className='page-action-menu-item'
            onClick={() => {
              runAndClose(() => {
                onStartCreateChild(pageId)
              })
            }}
          >
            + Child page
          </button>
          <button
            type='button'
            role='menuitem'
            tabIndex={-1}
            className='page-action-menu-item'
            onClick={() => {
              runAndClose(onStartMove)
            }}
          >
            Move
          </button>
          <button
            type='button'
            role='menuitem'
            tabIndex={-1}
            className='page-action-menu-item'
            disabled={duplicating}
            onClick={() => {
              runAndClose(() => void duplicate())
            }}
          >
            Duplicate
          </button>
          <button
            type='button'
            role='menuitem'
            tabIndex={-1}
            className='page-action-menu-item page-action-menu-item-danger'
            onClick={() => {
              runAndClose(onDelete)
            }}
          >
            Delete
          </button>
        </Popover>
      )}
    </div>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function PageHeader({
  editing,
  pageId,
  title,
  editTitle,
  onEditTitleChange,
  saving,
  onSave,
  onCancelEdit,
  onStartEdit,
  onStartCreateChild,
  onStartMove,
  onDelete,
  isPublicViewer,
}: {
  editing: boolean
  pageId: string
  title: string
  editTitle: string
  onEditTitleChange: (value: string) => void
  saving: boolean
  onSave: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  onStartCreateChild: (pageId: string) => void
  onStartMove: () => void
  onDelete: () => void
  isPublicViewer: boolean
}): JSX.Element {
  const isMobile = useIsMobileViewport()
  const { duplicate, duplicating } = useDuplicateWikiPage()
  return (
    <header className='wiki-page-header flex items-start justify-between gap-4 mb-1'>
      {editing ? (
        <input
          id='wiki-title'
          type='text'
          value={editTitle}
          onChange={(event) => {
            onEditTitleChange(event.target.value)
          }}
          aria-label='Page title'
          className='flex-1 px-3 py-2 border border-border rounded text-sm bg-bg text-text-base box-border text-2xl font-bold'
        />
      ) : (
        <h1 className='m-0 text-[1.75rem] font-bold text-text-base'>{title}</h1>
      )}

      {!isPublicViewer && (
        <div className='flex gap-2 shrink-0 max-sm:shrink'>
          {editing ? (
            <>
              <Button variant='primary' onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button variant='outline' onClick={onCancelEdit} disabled={saving}>
                Cancel
              </Button>
            </>
          ) : isMobile ? (
            <>
              <Button variant='outline' onClick={onStartEdit}>
                Edit
              </Button>
              <PageActionOverflowMenu
                pageId={pageId}
                onStartCreateChild={onStartCreateChild}
                onStartMove={onStartMove}
                onDelete={onDelete}
              />
            </>
          ) : (
            <>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  onStartCreateChild(pageId)
                }}
              >
                + Child page
              </Button>
              <Button variant='outline' size='sm' onClick={onStartMove}>
                Move
              </Button>
              <Button variant='outline' onClick={onStartEdit}>
                Edit
              </Button>
              <Button variant='outline' size='sm' disabled={duplicating} onClick={() => void duplicate()}>
                Duplicate
              </Button>
              <Button variant='danger' onClick={onDelete}>
                Delete
              </Button>
            </>
          )}
        </div>
      )}
    </header>
  )
}

/*
 * PROJ-495 (R13): the draft lives server-side now, so this can surface on any device —
 * not just after a crash on the same browser.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function DraftRestoreBanner({
  updatedAt,
  pageChangedSince,
  onRestore,
  onDiscard,
  busy,
}: {
  updatedAt: number
  pageChangedSince?: boolean
  busy: boolean
  onRestore: () => void
  onDiscard: () => void
}): JSX.Element {
  const bannerClass = [
    'mb-3 px-3 py-2 border border-border rounded bg-surface text-sm flex items-center',
    'justify-between gap-3 flex-wrap',
  ].join(' ')
  return (
    <div className={bannerClass}>
      <span>
        Restore unsaved draft from {formatTimestamp(updatedAt)}?
        {pageChangedSince && (
          <span className='block text-text-muted text-[0.8rem]'>
            The page has been saved since this draft was started — saving it will ask before overwriting.
          </span>
        )}
      </span>
      <div className='flex gap-2 shrink-0'>
        <Button variant='primary' size='sm' onClick={onRestore} disabled={busy}>
          Restore
        </Button>
        <Button variant='outline' size='sm' onClick={onDiscard} disabled={busy} aria-busy={busy}>
          Discard
        </Button>
      </div>
    </div>
  )
}

interface PageArticleProps {
  page: WikiPageData
  breadcrumbs: FlatEntry[]
  onNavigate: (slug: string) => void
  showToc: boolean
  toc: TocItem[]
  activeHeadingId: string
  /*
   * PROJ-803: a callback ref (not a plain RefObject) so remounting the content div
   * (Cancel edit / Verify / Move) is observable as a mount-token bump, not just a
   * silent `.current` update — see useWikiPageData's contentMountToken.
   */
  setContentRef: (node: HTMLDivElement | null) => void
  editing: boolean
  editTitle: string
  onEditTitleChange: (value: string) => void
  saving: boolean
  onSave: () => void
  onCancelEdit: () => void
  onStartEdit: () => void
  onStartCreateChild: (pageId: string) => void
  onDelete: () => void
  // PROJ-489 (R7): the metadata header card's Verify button.
  onVerify: () => void
  verifying: boolean
  verifyError: string | undefined
  moving: boolean
  moveOptions: SelectOption[]
  moveTargetId: string
  moveSaving: boolean
  moveError: string | undefined
  onStartMove: () => void
  onMoveTargetChange: (value: string) => void
  onSubmitMove: () => void
  onCancelMove: () => void
  latestRevision: WikiRevision | null
  saveError: string | undefined
  // PROJ-797: set only after a 409 — rebases the user's text onto the current revision.
  onOverwriteWithMine: (() => void) | null
  draftBanner: ServerDraft | null
  draftWarning: string | undefined
  onRestoreDraft: () => void
  onDiscardDraft: () => void
  editContent: string
  onEditContentChange: (value: string) => void
  // Prepared by the request-local Comark pipeline, including sanitized scoped wiki links.
  renderedHtml: string
  revisions: WikiRevision[]
  showHistory: boolean
  onToggleHistory: () => void
  onRestoreRevision: (revision: WikiRevision) => void
  restoringRevisionId: string | undefined
  attachments: Attachment[]
  workspaceSlug?: string
  uploadFormOpen: boolean
  uploadError: string | undefined
  onToggleUploadForm: (open: boolean) => void
  onCancelUpload: () => void
  onDeleteAttachment: (attachmentId: string) => void
  onUploadInlineImage: (file: File) => Promise<string | null>
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function PageArticleMeta(
  props: Pick<
    PageArticleProps,
    | 'page'
    | 'breadcrumbs'
    | 'onNavigate'
    | 'showToc'
    | 'toc'
    | 'activeHeadingId'
    | 'editing'
    | 'editTitle'
    | 'onEditTitleChange'
    | 'saving'
    | 'onSave'
    | 'onCancelEdit'
    | 'onStartEdit'
    | 'onStartCreateChild'
    | 'onDelete'
    | 'onVerify'
    | 'verifying'
    | 'verifyError'
    | 'moving'
    | 'moveOptions'
    | 'moveTargetId'
    | 'moveSaving'
    | 'moveError'
    | 'onStartMove'
    | 'onMoveTargetChange'
    | 'onSubmitMove'
    | 'onCancelMove'
    | 'latestRevision'
    | 'saveError'
    | 'onOverwriteWithMine'
    | 'draftBanner'
    | 'draftWarning'
    | 'onRestoreDraft'
    | 'onDiscardDraft'
    | 'workspaceSlug'
  >,
): JSX.Element {
  const isPublicViewer = usePublicViewer(props.workspaceSlug)
  return (
    <>
      <PageBreadcrumbs breadcrumbs={props.breadcrumbs} onNavigate={props.onNavigate} />

      {props.showToc && (
        <details className='mb-4 max-[900px]:block min-[901px]:hidden'>
          <summary className='cursor-pointer text-[0.8rem] text-text-muted select-none'>
            Contents ({props.toc.length})
          </summary>
          <div className='pt-2'>
            <TocList toc={props.toc} activeHeadingId={props.activeHeadingId} />
          </div>
        </details>
      )}

      <PageHeader
        editing={props.editing}
        pageId={props.page.id}
        title={props.page.title}
        editTitle={props.editTitle}
        onEditTitleChange={props.onEditTitleChange}
        saving={props.saving}
        onSave={props.onSave}
        onCancelEdit={props.onCancelEdit}
        onStartEdit={props.onStartEdit}
        onStartCreateChild={props.onStartCreateChild}
        onStartMove={props.onStartMove}
        onDelete={props.onDelete}
        isPublicViewer={isPublicViewer}
      />

      {!props.editing && (
        <WikiMetadataCard
          page={props.page}
          onVerify={props.onVerify}
          verifying={props.verifying}
          verifyError={props.verifyError}
          isPublicViewer={isPublicViewer}
        />
      )}

      {props.moving && (
        <MovePageForm
          options={props.moveOptions}
          value={props.moveTargetId}
          saving={props.moveSaving}
          error={props.moveError}
          onChange={props.onMoveTargetChange}
          onSubmit={props.onSubmitMove}
          onCancel={props.onCancelMove}
        />
      )}

      {props.latestRevision && (
        <p className='text-[0.8rem] text-text-muted mt-1 mb-5'>
          Last edited by <strong className='text-text-base'>{props.latestRevision.author_name ?? 'Unknown'}</strong> at{' '}
          {formatTimestamp(props.latestRevision.created_at)}
        </p>
      )}

      {props.saveError && (
        <div role='alert' className='text-danger-text mb-3'>
          <p className='m-0'>{props.saveError}</p>
          {props.onOverwriteWithMine && (
            <div className='mt-2 flex gap-2 flex-wrap items-center'>
              <Button variant='primary' size='sm' onClick={props.onOverwriteWithMine}>
                Overwrite with mine
              </Button>
              <span className='text-text-muted text-[0.8rem]'>or copy your text from the editor before reloading.</span>
            </div>
          )}
        </div>
      )}

      {props.editing && props.draftWarning && (
        <p role='status' className='bg-warning-bg border border-warning-border rounded px-3 py-2 text-[0.85rem] mb-3'>
          {props.draftWarning}
        </p>
      )}

      {props.editing && props.draftBanner && (
        <DraftRestoreBanner
          busy={props.saving}
          updatedAt={props.draftBanner.updatedAt}
          pageChangedSince={props.draftBanner.pageChangedSince}
          onRestore={props.onRestoreDraft}
          onDiscard={props.onDiscardDraft}
        />
      )}
    </>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function PageArticle(props: PageArticleProps): JSX.Element {
  const { page, setContentRef, renderedHtml } = props
  // PROJ-860: memoise the rendered-content vnode itself, keyed on the already-memoised
  // Keep the sanitized article element stable across unrelated sidebar and scroll updates.
  const articleContent = useMemo(
    () => (
      <div
        ref={setContentRef}
        className='markdown-content prose prose-sm max-w-none'
        // Comark output is sanitized after plugins, heading IDs and scoped wiki links.
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    ),
    [renderedHtml, setContentRef],
  )
  return (
    <div className='flex gap-8 items-start'>
      <article className='flex-1 min-w-0'>
        <PageArticleMeta {...props} />

        {props.editing ? (
          <div className='mb-3'>
            <MarkdownEditor
              value={props.editContent}
              onChange={props.onEditContentChange}
              minHeight='320px'
              onImageFile={props.onUploadInlineImage}
            />
          </div>
        ) : (
          articleContent
        )}

        <RevisionsHistory
          revisions={props.revisions}
          showHistory={props.showHistory}
          onToggle={props.onToggleHistory}
          workspaceSlug={props.workspaceSlug}
          pageSlug={page.slug}
          onRestore={props.onRestoreRevision}
          restoringId={props.restoringRevisionId}
          editing={props.editing}
        />

        <AttachmentsPanel
          attachments={props.attachments}
          workspaceSlug={props.workspaceSlug}
          content={props.editing ? props.editContent : page.content}
          uploadFormOpen={props.uploadFormOpen}
          uploadError={props.uploadError}
          onToggleUploadForm={props.onToggleUploadForm}
          onCancelUpload={props.onCancelUpload}
          onDeleteAttachment={props.onDeleteAttachment}
        />

        <footer className='mt-8 pt-4 border-t border-border text-xs text-text-muted'>
          Last updated: {formatTimestamp(page.updated_at)}
        </footer>
      </article>

      {props.showToc && (
        <nav
          className={[
            'w-[190px] shrink-0 sticky top-6 self-start max-h-[calc(100vh-3rem)]',
            'overflow-y-auto text-[0.8rem] max-[900px]:hidden',
          ].join(' ')}
          aria-label='Table of contents'
        >
          <h3 className='m-0 mb-2 text-xs uppercase tracking-[0.05em] text-text-muted font-semibold'>Contents</h3>
          <TocList toc={props.toc} activeHeadingId={props.activeHeadingId} />
        </nav>
      )}
    </div>
  )
}

interface CreateFormProps {
  parentTitle: string | null
  title: string
  slug: string
  content: string
  error: string | undefined
  saving: boolean
  templates: TemplateOption[]
  templateSlug: string
  onTitleChange: (value: string) => void
  onSlugChange: (value: string) => void
  onContentChange: (value: string) => void
  onTemplateChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function WikiMainContent(
  props: Readonly<{
    creating: boolean
    createProps: CreateFormProps
    slug: string
    loading: boolean
    error: string | null
    page: WikiPageData | null
    articleProps: Omit<PageArticleProps, 'page'>
  }>,
): undefined | JSX.Element {
  if (props.creating) {
    return <CreatePageForm {...props.createProps} />
  }
  if (!props.slug) {
    return <p className='text-text-muted'>Select a page from the sidebar or create a new one.</p>
  }
  if (props.loading) {
    return <p aria-live='polite'>Loading…</p>
  }
  if (props.error) {
    /*
     * PROJ-487: a slug that resolves to nothing (not even via a PROJ-483 redirect)
     * gets a dedicated 404 message rather than the generic failure text.
     */
    if (props.error.includes('404')) {
      return (
        <p role='alert' className='text-text-muted'>
          No wiki page found at "{props.slug}".
        </p>
      )
    }
    return (
      <p role='alert' className='text-danger-text'>
        Failed to load page: {props.error}
      </p>
    )
  }
  if (!props.page) {
    return undefined
  }
  return <PageArticle {...props.articleProps} page={props.page} />
}

// The server route DTO owns identity. The local empty-slug transition only supports optimistic deletion before native navigation completes.
function useWikiUrlState(_slugProp: string | undefined) {
  const seed = useWikiSeed()
  const [slug, setSlug] = useState(seed.slug)
  useEffect(() => {
    setSlug(seed.slug)
  }, [seed.slug])
  return { slug, setSlug }
}
function useWikiScope(_workspaceSlug: string | undefined, _projectIdProp: string | undefined): string {
  return useWikiSeed().projectId
}

function useWikiTree(
  _workspaceSlug: string | undefined,
  _projectId: string | undefined,
): { pageTree: TreeNode[]; pageMap: Record<string, FlatEntry>; treeLoading: boolean } {
  const seed = useWikiSeed()
  const pageTree = seed.tree
  const pageMap = useMemo(() => flattenTree(pageTree), [pageTree])
  return { pageTree, pageMap, treeLoading: false }
}

// Preserve the original collapsible maintenance queue, seeded with request-owned stale-page DTOs.
function useWikiStalePages(_workspaceSlug: string | undefined, _projectId: string | undefined) {
  const seed = useWikiSeed()
  const [staleOpen, setStaleOpen] = useState(false)
  return { staleOpen, setStaleOpen, stalePages: seed.stalePages, staleLoading: false }
}

/*
 * PROJ-488: type/status/tags filters shared between the sidebar's filtered browse view
 * (no search query — a flat list from listWikiPages) and text search below (combined
 * with the FTS query via search_wiki's own type/status/tags params).
 */
function useWikiFilters(
  _workspaceSlug: string | undefined,
  _projectId: string | undefined,
  pageTree: Readonly<TreeNode[]>,
) {
  const seed = useWikiSeed()
  const filterForm = useForm({
    defaultValues: { type: seed.filterType, status: seed.filterStatus, tags: seed.filterTags },
    validators: { onChange: Schema.toStandardSchemaV1(FilterFields) },
  })
  const {
    type: filterType,
    status: filterStatus,
    tags: filterTags,
  } = useStore(filterForm.store, (state) => state.values)
  useEffect(() => {
    filterForm.reset({ type: seed.filterType, status: seed.filterStatus, tags: seed.filterTags })
  }, [filterForm, seed.filterType, seed.filterStatus, seed.filterTags])
  const typeOptions = useMemo(() => buildTypeFilterOptions(collectTreeTypes(pageTree)), [pageTree])
  return {
    filterType,
    setFilterType: (value: string) => {
      filterForm.setFieldValue('type', value)
    },
    filterStatus,
    setFilterStatus: (value: string) => {
      filterForm.setFieldValue('status', value)
    },
    filterTags,
    setFilterTags: (value: string) => {
      filterForm.setFieldValue('tags', value)
    },
    filteredResults: seed.filteredPages,
    filteredLoading: false,
    hasActiveFilters: Boolean(seed.filterType || seed.filterStatus || seed.filterTags.trim()),
    typeOptions,
  }
}

function useWikiSearch(
  _workspaceSlug: string | undefined,
  _projectId: string | undefined,
  _filters: Readonly<{ filterType: string; filterStatus: string; filterTags: string }>,
) {
  const seed = useWikiSeed()
  const searchForm = useForm({
    defaultValues: { query: seed.searchQuery },
    validators: { onChange: Schema.toStandardSchemaV1(SearchFields) },
  })
  const searchQuery = useStore(searchForm.store, (state) => state.values.query)
  useEffect(() => {
    searchForm.reset({ query: seed.searchQuery })
  }, [searchForm, seed.searchQuery])
  return {
    searchQuery,
    setSearchQuery: (value: string) => {
      searchForm.setFieldValue('query', value)
    },
    searchResults: seed.searchResults,
    searchLoading: false,
  }
}

function useWikiPageData(_workspaceSlug: string | undefined, _slug: string) {
  const seed = useWikiSeed()
  const [deletedPageId, setDeletedPageId] = useState<string | null>(null)
  const page = seed.page?.id === deletedPageId ? null : seed.page
  const setPage = (value: WikiPageData | null): void => {
    setDeletedPageId(value ? null : (seed.page?.id ?? null))
  }
  const loading = false
  const error = seed.slug && !seed.page ? '404' : null
  const { revisions } = seed
  /*
   * PROJ-507: whether `revisions` reflects a completed fetch for this page. An empty
   * list means two very different things to the optimistic lock — "this page has never
   * been revised" (baseRevisionId: null) vs "we don't know yet" — and conflating them
   * makes a legitimate save look like a conflict.
   */
  const revisionsLoaded = true
  const [showHistory, setShowHistory] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  /*
   * PROJ-803: the content div only mounts when `!editing` (PageArticle), so Cancel
   * edit / Verify / Move — anything that flips `editing` or otherwise remounts that
   * div without page.content changing — used to leave the TOC pointing at detached
   * nodes and mermaid blocks unrendered, because the post-render effects keyed only
   * on content. A callback ref bumps this token on every mount so those effects can
   * key on "the DOM actually changed" instead, composing with PROJ-860's HTML memo
   * (effects now depend on [renderedHtml, contentMountToken] — either changing means
   * there's new DOM to process).
   *
   * Why a counter and not the node itself in state: Preact recycles the same <div>
   * across Edit → Cancel (it morphs the article div into MarkdownEditor's root and
   * back, resetting innerHTML on the way), so the ref is called again with the
   * *identical* node and a [node] dependency would never change — the original bug. It
   * can also deliver the old mount's `null` after the new node. A bump on every non-null
   * call survives both. The cost is one extra run of these effects on first mount (the
   * bump lands in the commit after the HTML does).
   */
  const [contentMountToken, setContentMountToken] = useState(INITIAL_CONTENT_MOUNT_TOKEN)
  const setContentRef = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    if (node) {
      setContentMountToken((mountToken) => mountToken + CONTENT_MOUNT_TOKEN_STEP)
    }
  }, [])

  /*
   * Revisions belong to the page the `slug` prop points at, so they're reset when it
   * changes — not on every fetchPage(), which also runs as a same-page refresh (after
   * a save or a move) and would leave the list empty until something refetched it.
   * Same-URL ServerFn refresh updates canonical state without touching editor drafts.
   */
  useEffect(() => {
    if (seed.page) {
      setDeletedPageId(null)
    }
  }, [seed.page])

  return {
    page,
    setPage,
    loading,
    error,
    revisions,
    revisionsLoaded,
    showHistory,
    setShowHistory,
    contentRef,
    setContentRef,
    contentMountToken,
  }
}

function excerptOf(content: string, maxLength = 200): string {
  // PROJ-488: never let a page's frontmatter YAML become its og:description.
  const plain = stripFrontmatter(content)
    .replaceAll(/```[\s\S]*?```/gu, ' ')
    .replaceAll(/[#*_>`[\]()!-]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return plain.length > maxLength ? `${plain.slice(EXCERPT_START, maxLength).trimEnd()}…` : plain
}

/**
 * Persisted content and compiler-owned ToC arrive in canonical server props.
 * Only local unsaved previews need a bounded asynchronous client render.
 *
 * @param {string | undefined} content The current Wiki Markdown, when a page is available.
 * @param {Readonly<{ title: string; slug: string }[]>} wikiPages The available page titles and slugs used to resolve Wiki links.
 * @returns {RenderedMarkdown} The canonical or locally rendered HTML and table of contents.
 */
function useRenderedPageMarkdown(
  content: string | undefined,
  wikiPages: Readonly<{ title: string; slug: string }[]>,
): RenderedMarkdown {
  const seed = useWikiSeed()
  return useMarkdownPreview(
    stripFrontmatter(content ?? ''),
    {
      pages: wikiPages.map(({ title, slug }) => ({ title, slug })),
      workspaceSlug: seed.workspaceSlug,
      projectId: seed.projectId,
    },
    Predicate.isNullish(content) ? undefined : seed.renderedMarkdown,
  )
}

function useTableOfContents(
  _page: WikiPageData | null,
  contentRef: RefObject<HTMLDivElement | null>,
  rendered: RenderedMarkdown,
  /*
   * PROJ-803: bumped by the content div's callback ref every time it mounts, so
   * Cancel/Verify/Move (which remount the div without page.content changing) still
   * re-run these effects against the new DOM node.
   */
  contentMountToken: number,
) {
  const toc = useMemo(() => [...rendered.toc], [rendered])
  const [activeHeadingId, setActiveHeadingId] = useState('')

  // PROJ-113: IntersectionObserver for active heading
  useEffect(() => {
    if (toc.length < MIN_TOC_ENTRIES || typeof IntersectionObserver === 'undefined') {
      return
    }
    const container = contentRef.current
    if (!container) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHeadingId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-10% 0% -70% 0%', threshold: 0 },
    )
    const headings = container.querySelectorAll('h1[id], h2[id], h3[id]')
    headings.forEach((element) => {
      observer.observe(element)
    })
    return () => {
      observer.disconnect()
    }
  }, [toc, contentRef, contentMountToken])

  return { toc, activeHeadingId }
}

/*
 * PROJ-802: heading ids are only assigned once the content has rendered (the effects
 * above), so a link like /wiki/foo#setup used to always open at the top of the page —
 * nothing ever re-checked location.hash once the target id actually existed. `toc`
 * changing covers first load and framework navigation, which rebuild the
 * page and its TOC); hashchange covers clicking a same-page #anchor (including a TOC
 * link) without a full navigation. Native currententrychange covers Back/Forward.
 *
 * A TOC rebuild is *not* a navigation, though: Cancel edit, Verify, Move and a late tree
 * load all rebuild it on the same page and hash. Re-scrolling on each of those yanked the
 * reader back to the anchor and stole focus from whatever they were doing, so each
 * page-slug + hash pair is handled once. Only hash or native entry changes (navigation,
 * even back to the same hash) clear that and allow another scroll.
 */
function findInContent(container: HTMLElement, id: string): HTMLElement | null {
  /*
   * Only the rendered page body counts — an id elsewhere (the sidebar's
   * `wiki-page-tree`, the TOC nav, …) must not hijack the anchor. Matched by property
   * rather than a `#id` selector so ids needing CSS escaping still work.
   */
  for (const el of container.querySelectorAll<HTMLElement>('[id]')) {
    if (el.id === id) {
      return el
    }
  }
  return null
}

function useHashScroll(
  toc: Readonly<TocItem[]>,
  contentRef: RefObject<HTMLDivElement | null>,
  pageSlug: string | undefined,
): void {
  const handledRef = useRef('')

  const scrollToHash = useCallback(() => {
    // PROJ-802: some call sites (and this file's own tests, see PROJ-487) swap
    // `window.location` for a partial stand-in that may not define `hash` at all.
    const raw = (window.location.hash ?? '').slice(HASH_CONTENT_START)
    if (!raw) {
      return
    }
    const key = `${pageSlug ?? ''}#${raw}`
    if (handledRef.current === key) {
      return
    }
    const container = contentRef.current
    if (!container) {
      return
    }
    const heading = findInContent(container, safeDecodeURIComponent(raw) ?? raw)
    /*
     * Not rendered yet (or not on this page) — leave it unhandled so the next TOC
     * build, once the target exists, can still scroll to it.
     */
    if (!heading) {
      return
    }
    handledRef.current = key
    heading.scrollIntoView()
    /*
     * Headings aren't focusable by default — tabindex=-1 lets focus() target them
     * programmatically (screen reader users land there too) without adding them to
     * the normal Tab order.
     */
    heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
  }, [contentRef, pageSlug])

  useEffect(() => {
    if (Array.isReadonlyArrayNonEmpty(toc)) {
      scrollToHash()
    }
  }, [toc, scrollToHash])

  useEffect(() => {
    const onNavigate = function onNavigate(): void {
      handledRef.current = ''
      scrollToHash()
    }
    const browserWindow: NavigationWindow = window
    window.addEventListener('hashchange', onNavigate)
    browserWindow.navigation?.addEventListener('currententrychange', onNavigate)
    return () => {
      window.removeEventListener('hashchange', onNavigate)
      browserWindow.navigation?.removeEventListener('currententrychange', onNavigate)
    }
  }, [scrollToHash])
}

type NavigationWindow = Partial<Pick<Window, 'navigation'>>

function useWikiAttachments(workspaceSlug: string | undefined, page: WikiPageData | null) {
  const seed = useWikiSeed()
  const [uploadFormOpen, setUploadFormOpen] = useState(false)
  const [uploadError, setUploadError] = useState<string>()
  const [inlineAttachments, setInlineAttachments] = useState<Attachment[]>([])
  const attachments = [
    ...seed.attachments,
    ...inlineAttachments.filter((file) => !seed.attachments.some((current) => current.id === file.id)),
  ]
  const cancelUpload = function cancelUpload(): void {
    setUploadFormOpen(false)
    setUploadError(undefined)
  }
  const deleteAttachment = async function deleteAttachment(attachmentId: string): Promise<void> {
    if (!page) {
      return
    }
    setUploadError(undefined)
    try {
      unwrapResult(await deleteWikiAttachment({ workspaceSlug, attachmentId }))
      setInlineAttachments((files) => files.filter((file) => file.id !== attachmentId))
    } catch (error) {
      setUploadFormOpen(true)
      setUploadError(`Couldn't delete attachment: ${globalThis.String(error)}`)
    }
  }
  const uploadInlineImage = async function uploadInlineImage(file: File): Promise<string | null> {
    if (!page || Predicate.isNullish(workspaceSlug) || String.isEmpty(workspaceSlug)) {
      return null
    }
    try {
      // A named ServerFn preserves the draft/cursor while retaining Effront's request-body limit.
      const uploaded = unwrapResult(
        await uploadEditorImage({
          file,
          workspaceSlug,
          entityType: 'wiki_page',
          entityId: page.id,
        }),
      )
      setInlineAttachments((files) => [...files, { ...uploaded, createdAt: currentEpochSeconds() }])
      return `/api/files/${encodeURIComponent(uploaded.id)}?workspace=${encodeURIComponent(workspaceSlug)}`
    } catch (error) {
      setUploadError(globalThis.String(error))
      return null
    }
  }
  return {
    attachments,
    uploadFormOpen,
    setUploadFormOpen,
    uploadError,
    cancelUpload,
    deleteAttachment,
    uploadInlineImage,
  }
}

/*
 * PROJ-800: closing or reloading the tab mid-edit asks first when there are unsaved
 * changes — a debounced draft can't be flushed from an unloading page reliably.
 */
function useUnsavedChangesGuard(
  editing: boolean,
  page: WikiPageData | null,
  editTitle: string,
  editContent: string,
): void {
  const dirty = editing && Predicate.isNotNullish(page) && differsFromPublished(page, editTitle, editContent)
  useEffect(() => {
    if (!dirty) {
      return
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = ''
    }
    const onNavigate = (event: NavigateEvent): void => {
      const destination = new URL(event.destination.url)
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return
      }
      if (
        event.cancelable &&
        !window.confirm('Leave this page with unsaved changes? Save your changes first to avoid losing them.')
      ) {
        event.preventDefault()
      }
    }
    const browserWindow: NavigationWindow = window
    window.addEventListener('beforeunload', onBeforeUnload)
    browserWindow.navigation?.addEventListener('navigate', onNavigate)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      browserWindow.navigation?.removeEventListener('navigate', onNavigate)
    }
  }, [dirty])
}

/*
 * PROJ-507: a 409 means someone else saved this page after we loaded it (PROJ-484's
 * optimistic lock rejected our stale baseRevisionId) — surface that distinctly rather
 * than the generic failure message, so the user knows to reload instead of retrying the
 * A typed ServerFn conflict is distinct from a protocol/network failure.
 */
function isWikiSaveConflict(failure: unknown): boolean {
  return failure instanceof FunctionError
    ? failure.status === HTTP_CONFLICT
    : globalThis.String(failure).endsWith('failed: 409')
}

function wikiSaveErrorMessage(failure: unknown): string {
  if (isWikiSaveConflict(failure)) {
    return (
      'This page was changed by someone else since you started editing. Overwrite it with ' +
      'your version, or copy your text and reload to merge by hand.'
    )
  }
  return `Save failed: ${globalThis.String(failure)}`
}

function useWikiEditing(
  workspaceSlug: string | undefined,
  page: WikiPageData | null,
  latestRevisionId: string | null | undefined,
) {
  const seed = useWikiSeed()
  const [editing, setEditing] = useState(seed.mode === 'edit')
  const defaultValues: typeof EditFields.Type = {
    title: seed.page?.title ?? '',
    content: seed.page?.content ?? '',
    baseRevisionId: seed.page?.revisionId ?? seed.revisions[0]?.id ?? null,
  }
  const editForm = useForm({
    defaultValues,
    validators: { onChange: Schema.toStandardSchemaV1(EditFields) },
  })
  const { title: editTitle, content: editContent, baseRevisionId } = useStore(editForm.store, (state) => state.values)
  const editVersionRef = useRef(INITIAL_EDIT_VERSION)
  const operationRef = useRef(false)
  const sessionRef = useRef(INITIAL_EDIT_SESSION)
  useEffect(
    () => () => {
      sessionRef.current += 1
    },
    [],
  )
  const setEditTitle = (value: string): void => {
    editVersionRef.current += 1
    editForm.setFieldValue('title', value)
  }
  const setEditContent = (value: string): void => {
    editVersionRef.current += 1
    editForm.setFieldValue('content', value)
  }
  const setBaseRevisionId = (value: string | null | undefined): void => {
    editForm.setFieldValue('baseRevisionId', value)
  }
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  // PROJ-797: the last save hit a 409 (someone else saved first).
  const [conflict, setConflict] = useState(false)
  const [draftBanner, setDraftBanner] = useState<ServerDraft | null>(
    seed.mode === 'edit' &&
      seed.draft &&
      seed.page &&
      differsFromPublished(seed.page, seed.draft.title, seed.draft.content)
      ? { ...seed.draft, pageChangedSince: seed.draft.baseRevisionId !== seed.page.revisionId }
      : null,
  )
  /*
   * PROJ-507: the revision id of the content the user actually started editing,
   * frozen at startEdit() time — sent back as baseRevisionId so the server can
   * detect a concurrent edit landing between load and save (PROJ-484's optimistic
   * lock). Using the live `latestRevisionId` at save time instead would defeat the
   * check, since it tracks whatever the page's latest revision is *right now*.
   * `undefined` (revisions not loaded when editing started) omits the field, which
   * the server treats as the transitional last-write-wins path — sending `null` there
   * would instead assert "this page has no revisions" and fail every save.
   * PROJ-495: this same value is what the draft autosave stamps as its own
   * baseRevisionId, and restoring a draft snaps it back to the draft's own
   * baseRevisionId — so publishing a restored draft conflict-checks against what the
   * draft actually started from, not whatever the page's latest revision happens to
   * be now.
   */

  const [draftStatus, setDraftStatus] = useState<DraftStatus>(seed.draftStatus)

  const {
    skipLeaveFlushRef,
    serverHasDraftRef,
    flushDraftNow,
    adoptDraftState,
    discardDraftNow,
    publishDraft,
    writeWarning,
    needsReconciliation,
  } = useServerDraftAutosave({
    workspaceSlug,
    editing,
    editTitle,
    editContent,
    page,
    draftBanner,
    baseRevisionId,
    saving,
    draftStatus,
  })
  useUnsavedChangesGuard(editing, page, editTitle, editContent)

  /*
   * PROJ-495: draft is fetched from the server (not just a local check) so it
   * restores across devices, not only after a same-browser crash. Editing opens
   * immediately with the published content; the restore banner appears once the
   * fetch resolves, matching the R10 diff/choice pattern of offering rather than
   * silently applying.
   */
  const startEdit = async function startEdit(): Promise<void> {
    if (!page) {
      return
    }
    const session = ++sessionRef.current
    setSaveError(undefined)
    setDraftBanner(null)
    setDraftStatus('loading')
    serverHasDraftRef.current = false
    /*
     * PROJ-809: prefer the revision read together with this content; the separately
     * fetched revisions list can already include a save that the content predates.
     */
    setBaseRevisionId(isWikiRevisionSpecified(page.revisionId) ? page.revisionId : latestRevisionId)
    setEditTitle(page.title)
    setEditContent(page.content)
    setEditing(true)
    try {
      const state = unwrapResult(await Effect.runPromise(query(getWikiDraftState)({ workspaceSlug, slug: page.slug })))
      if (sessionRef.current !== session) {
        return
      }
      adoptDraftState(state)
      const { draft } = state
      /*
       * PROJ-797: offer any draft that differs from what's published, regardless
       * of timestamp order — a publish by someone else after the last autosave
       * used to hide the user's draft silently. The banner notes when the page
       * has changed since the draft was started.
       */
      if (draft && (draft.content !== page.content || draft.title !== page.title)) {
        const pageChangedSince = isWikiRevisionSpecified(page.revisionId)
          ? draft.baseRevisionId !== page.revisionId
          : draft.updatedAt <= page.updated_at
        setDraftBanner({ ...draft, pageChangedSince })
      }
      /*
       * A draft identical to the published page is still a row we may delete if
       * the user types and then reverts.
       */
      serverHasDraftRef.current = Boolean(draft)
      setDraftStatus('ready')
    } catch {
      if (sessionRef.current !== session) {
        return
      }
      /*
       * PROJ-799: we can't tell whether a draft from another device exists, so
       * autosaving now could silently overwrite it. Keep editing, but don't autosave.
       */
      setDraftStatus('failed')
    }
  }

  const restoreDraft = function restoreDraft(): void {
    if (!draftBanner) {
      return
    }
    setEditTitle(draftBanner.title)
    setEditContent(draftBanner.content)
    setBaseRevisionId(draftBanner.baseRevisionId)
    setDraftBanner(null)
    serverHasDraftRef.current = true
  }

  const discardDraft = async function discardDraft(): Promise<void> {
    if (!page || operationRef.current) {
      return
    }
    operationRef.current = true
    setSaving(true)
    const version = editVersionRef.current
    const session = sessionRef.current
    await (async () => {
      try {
        await discardDraftNow(page, editTitle, editContent)
        if (sessionRef.current !== session) {
          return
        }
        if (editVersionRef.current === version) {
          setEditTitle(page.title)
          setEditContent(page.content)
        }
        setDraftBanner(null)
        setDraftStatus('ready')
      } catch (error) {
        if (sessionRef.current === session) {
          setSaveError(wikiSaveErrorMessage(error))
        }
      }
    })().finally(() => {
      operationRef.current = false
      if (sessionRef.current === session) {
        setSaving(false)
      }
    })
  }

  const cancelEdit = function cancelEdit(): void {
    sessionRef.current += 1
    /*
     * PROJ-796: while the restore banner is unresolved, the server draft is the
     * user's unsaved work from elsewhere — leaving must not overwrite it with the
     * published text the editor was opened with.
     */
    if (draftBanner) {
      skipLeaveFlushRef.current = true
    }
    setEditing(false)
    setSaveError(undefined)
    setConflict(false)
    setDraftBanner(null)
  }

  const saveWithBase = async function saveWithBase(baseOverride?: string | null): Promise<void> {
    if (!page || operationRef.current) {
      return
    }
    operationRef.current = true
    const version = editVersionRef.current
    const session = sessionRef.current
    const snapshot = {
      page,
      title: editTitle,
      content: editContent,
      base: isWikiRevisionSpecified(baseOverride) ? baseOverride : baseRevisionId,
    }
    setSaving(true)
    setSaveError(undefined)
    setConflict(false)
    await (async () => {
      try {
        if (
          !Schema.is(EditFields)({ title: snapshot.title, content: snapshot.content, baseRevisionId: snapshot.base })
        ) {
          setSaveError('Use a title between 1 and 300 characters and content at most 500000 characters.')
          return
        }
        if (draftStatus === 'failed' || needsReconciliation()) {
          const state = unwrapResult(
            await Effect.runPromise(query(getWikiDraftState)({ workspaceSlug, slug: page.slug })),
          )
          if (sessionRef.current !== session) {
            return
          }
          adoptDraftState(state)
          setDraftStatus('ready')
          if (state.draft && differsFromPublished(snapshot, state.draft.title, state.draft.content)) {
            setDraftBanner({ ...state.draft, pageChangedSince: state.draft.baseRevisionId !== snapshot.base })
            setSaveError('Review the saved draft before publishing. Your current text has been kept.')
            return
          }
        }
        const published = await publishDraft(snapshot)
        if (sessionRef.current !== session) {
          return
        }
        if (editVersionRef.current === version) {
          skipLeaveFlushRef.current = true
          setEditing(false)
        } else {
          if (Predicate.isNullish(published.draftRevision)) {
            setDraftStatus('failed')
          }
          try {
            const current = unwrapResult(
              await Effect.runPromise(query(getWikiPage)({ workspaceSlug, slug: page.slug })),
            )
            if (
              sessionRef.current === session &&
              current.title === snapshot.title &&
              current.content === snapshot.content
            ) {
              setBaseRevisionId(current.revisionId)
            }
          } catch {
            // Keep the prior publication precondition if the refreshed page cannot be read.
          }
        }
      } catch (caughtError) {
        if (sessionRef.current !== session) {
          return
        }
        setSaveError(wikiSaveErrorMessage(caughtError))
        setConflict(isWikiSaveConflict(caughtError))
        setDraftStatus('failed')
      }
    })().finally(() => {
      operationRef.current = false
      if (sessionRef.current === session) {
        setSaving(false)
      }
    })
  }

  // Wired straight to onClick, so it must not take the event as an argument.
  const save = function save(): Promise<void> {
    return saveWithBase()
  }

  /*
   * PROJ-797: after a 409 the user is never stuck — this re-reads the page's current
   * revision and saves their text on top of it (a deliberate overwrite). Their text
   * stays in the editor either way, so they can also copy it out instead.
   */
  const overwriteWithMine = async function overwriteWithMine(): Promise<void> {
    if (!page) {
      return
    }
    try {
      const state = unwrapResult(await Effect.runPromise(query(getWikiDraftState)({ workspaceSlug, slug: page.slug })))
      adoptDraftState(state)
      setDraftStatus('ready')
      const current = unwrapResult(await Effect.runPromise(query(getWikiPage)({ workspaceSlug, slug: page.slug })))
      const base = current.revisionId
      setBaseRevisionId(base)
      /*
       * Null is a real base ("page has no revisions"); undefined means "server
       * predates revisionId", which falls back to last-write-wins.
       */
      await saveWithBase(base ?? null)
    } catch (caughtError) {
      setSaveError(wikiSaveErrorMessage(caughtError))
    }
  }

  return {
    editing,
    setEditing,
    editTitle,
    setEditTitle,
    editContent,
    setEditContent,
    saving,
    saveError,
    overwriteWithMine: conflict ? overwriteWithMine : null,
    draftBanner,
    draftWarning:
      editing && draftStatus === 'failed'
        ? "Couldn't check for an unsaved draft from another device, so autosave is off for this edit. Save when you're done."
        : writeWarning,
    flushDraftNow,
    startEdit,
    restoreDraft,
    discardDraft,
    cancelEdit,
    save,
  }
}

/*
 * PROJ-492 (R10): one-click restore is a client-side convenience — it reads the old
 * revision's content, then resubmits it through the SAME update_wiki_page write path as
 * a normal edit (baseRevisionId + summary), so it gets ordinary optimistic-locking/
 * frontmatter/FTS/link-reindex treatment for free and creates a new revision rather than
 * rewriting history. No dedicated restore endpoint.
 */
function useWikiRestore(
  workspaceSlug: string | undefined,
  page: WikiPageData | null,
  latestRevisionId: string | null | undefined,
  editing: boolean,
) {
  const [restoringId, setRestoringId] = useState<string>()

  const restore = async function restore(revision: WikiRevision): Promise<void> {
    if (!page) {
      return
    }
    /*
     * PROJ-808: the Restore button is disabled while editing, but guard the action
     * itself too — restoring mid-edit races the edit's own save against this PUT,
     * and whichever lands second 409s against a revision it created itself.
     */
    if (editing) {
      return
    }
    const when = formatTimestamp(revision.created_at)
    if (
      !window.confirm(
        `Restore this page to the version from ${when}? This creates a new revision — no history is lost.`,
      )
    ) {
      return
    }
    setRestoringId(revision.id)
    try {
      unwrapResult(
        await restoreWikiRevision({
          workspaceSlug,
          slug: page.slug,
          revisionId: revision.id,
          baseRevisionId: latestRevisionId ?? null,
        }),
      )
    } catch (caughtError) {
      if (isWikiSaveConflict(caughtError)) {
        alert('This page was changed by someone else since you loaded it. Reload the page before restoring.')
      } else {
        alert(`Restore failed: ${globalThis.String(caughtError)}`)
      }
    }
    setRestoringId(undefined)
  }

  return { restoringId, restore }
}

/*
 * PROJ-237: re-parent a page from the page menu. Backend validation (cycle guard,
 * workspace scoping) already exists on PUT /api/wiki/:slug — this is UI-only.
 */
function useMovePage(workspaceSlug: string | undefined, page: WikiPageData | null) {
  const [moving, setMoving] = useState(false)
  const moveForm = useForm({
    defaultValues: { parentId: '' },
    validators: { onChange: Schema.toStandardSchemaV1(MoveFields) },
  })
  const moveTargetId = useStore(moveForm.store, (state) => state.values.parentId)
  const setMoveTargetId = (value: string): void => {
    moveForm.setFieldValue('parentId', value)
  }
  const [moveSaving, setMoveSaving] = useState(false)
  const [moveError, setMoveError] = useState<string>()

  const startMove = function startMove(): void {
    if (!page) {
      return
    }
    setMoveTargetId(page.parent_id ?? '')
    setMoveError(undefined)
    setMoving(true)
  }

  const cancelMove = function cancelMove(): void {
    setMoving(false)
    setMoveError(undefined)
  }

  const submitMove = async function submitMove(): Promise<void> {
    if (!page) {
      return
    }
    setMoveSaving(true)
    setMoveError(undefined)
    try {
      unwrapResult(await moveWikiPage({ workspaceSlug, slug: page.slug, parentId: moveTargetId || null }))
      setMoving(false)
    } catch (caughtError) {
      setMoveError(`Move failed: ${globalThis.String(caughtError)}`)
    }
    setMoveSaving(false)
  }

  return {
    moving,
    moveTargetId,
    setMoveTargetId,
    moveSaving,
    moveError,
    startMove,
    cancelMove,
    submitMove,
  }
}

/*
 * PROJ-489 (R7): stamps verified_at/verified_by (server resolves the CALLING user's
 * identity — nothing to pass here) and refetches the page so the header reflects the
 * new freshness state immediately.
 */
function useWikiVerify(workspaceSlug: string | undefined, page: WikiPageData | null) {
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string>()

  const verifyPage = async function verifyPage(): Promise<void> {
    if (!page) {
      return
    }
    setVerifying(true)
    setVerifyError(undefined)
    try {
      unwrapResult(await verifyWikiPage({ workspaceSlug, slug: page.slug }))
    } catch (caughtError) {
      setVerifyError(`Verify failed: ${globalThis.String(caughtError)}`)
    }
    setVerifying(false)
  }

  return { verifying, verifyError, verifyPage }
}

function useCreatePageForm(workspaceSlug: string | undefined, projectId: string) {
  const seed = useWikiSeed()
  const [creating, setCreating] = useState(seed.mode === 'create' || Boolean(seed.createTitle))
  const createForm = useForm({
    defaultValues: {
      title: seed.createTitle,
      slug: slugify(seed.createTitle),
      content: '',
      parentId: null as string | null,
      templateSlug: '',
    },
    validators: { onChange: Schema.toStandardSchemaV1(CreateFields) },
  })
  const {
    title: createTitle,
    slug: createSlug,
    content: createContent,
    parentId: createParentId,
    templateSlug: createTemplateSlug,
  } = useStore(createForm.store, (state) => state.values)
  const setCreateTitle = (value: string): void => {
    createForm.setFieldValue('title', value)
  }
  const setCreateSlug = (value: string): void => {
    createForm.setFieldValue('slug', value)
  }
  const setCreateContent = (value: string): void => {
    createForm.setFieldValue('content', value)
  }
  const setCreateParentId = (value: string | null): void => {
    createForm.setFieldValue('parentId', value)
  }
  const setCreateTemplateSlug = (value: string): void => {
    createForm.setFieldValue('templateSlug', value)
  }
  const [createError, setCreateError] = useState<string>()
  const [createSaving, setCreateSaving] = useState(false)
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  /*
   * PROJ-491 (R9): "" means no template selected — content is edited freely. Selecting a
   * template seeds content from create_wiki_page's templateSlug (server-side, mutually
   * exclusive with content) rather than duplicating the strip-template-flag logic here.
   */

  const startCreate = function startCreate(parentId: string | null = null): void {
    setCreating(true)
    setCreateTitle('')
    setCreateSlug('')
    setCreateContent('')
    setCreateParentId(parentId)
    setCreateError(undefined)
    setSlugManuallyEdited(false)
    setCreateTemplateSlug('')
  }

  const cancelCreate = function cancelCreate(): void {
    setCreating(false)
    setCreateError(undefined)
  }

  const onCreateTitleChange = function onCreateTitleChange(title: string): void {
    setCreateTitle(title)
    if (!slugManuallyEdited) {
      setCreateSlug(slugify(title))
    }
  }

  const onCreateSlugChange = function onCreateSlugChange(slug: string): void {
    setCreateSlug(slug)
    setSlugManuallyEdited(true)
  }

  const onCreateTemplateChange = function onCreateTemplateChange(templateSlug: string): void {
    setCreateTemplateSlug(templateSlug)
    if (templateSlug) {
      setCreateContent('')
    }
  }

  const submitCreate = async function submitCreate(): Promise<string | undefined> {
    await createForm.validate('change')
    if (!createForm.state.isValid) {
      setCreateError('Check the title, slug, and content limits.')
      return
    }
    if (!createTitle.trim()) {
      setCreateError('Title is required.')
      return
    }
    const finalSlug = createSlug.trim() || slugify(createTitle)
    if (!finalSlug) {
      setCreateError('Slug could not be derived from title.')
      return
    }
    setCreateSaving(true)
    setCreateError(undefined)
    try {
      const created = unwrapResult(
        await createWikiPage({
          workspaceSlug,
          projectId: projectId || undefined,
          title: createTitle.trim(),
          slug: finalSlug,
          ...(createTemplateSlug ? { templateSlug: createTemplateSlug } : { content: createContent }),
          ...(Predicate.isNotNullish(createParentId) && String.isNonEmpty(createParentId)
            ? { parentId: createParentId }
            : {}),
        }),
      )
      setCreating(false)
      setCreateSaving(false)
      return created.slug
    } catch (caughtError) {
      setCreateError(`Create failed: ${globalThis.String(caughtError)}`)
    }
    setCreateSaving(false)
    return undefined
  }

  return {
    creating,
    setCreating,
    createTitle,
    createSlug,
    createContent,
    setCreateContent,
    createParentId,
    createError,
    createSaving,
    createTemplateSlug,
    startCreate,
    cancelCreate,
    onCreateTitleChange,
    onCreateSlugChange,
    onCreateTemplateChange,
    submitCreate,
  }
}

function createWikiActions(
  args: Readonly<{
    workspaceSlug: string | undefined
    page: WikiPageData | null
    setSlug: (nextSlug: string) => void
    setEditing: (isEditing: boolean) => void
    flushDraftNow: () => void
    setPage: (nextPage: WikiPageData | null) => void
    rawStartCreate: (parentId: string | null) => void
    rawSubmitCreate: () => Promise<string | undefined>
    cancelMove: () => void
    /*
     * PROJ-807: shown after a successful delete, with an Undo action that calls the
     * existing trash-undelete endpoint. null dismisses whatever toast is showing.
     */
    showUndoToast: (toast: UndoToast | null) => void
    navigate: (path: string) => void
  }>,
) {
  const { workspaceSlug, page, setSlug, setEditing, setPage, showUndoToast } = args

  const navigateTo = function navigateTo(slug: string): void {
    args.flushDraftNow()
    args.navigate(slug ? `/wiki/${encodeURIComponent(slug)}` : '/wiki')
  }

  const startCreate = function startCreate(parentId: string | null = null): void {
    setEditing(false)
    args.cancelMove()
    args.rawStartCreate(parentId)
  }

  const submitCreate = async function submitCreate(): Promise<void> {
    const createdSlug = await args.rawSubmitCreate()
    if (Predicate.isNotNullish(createdSlug) && String.isNonEmpty(createdSlug)) {
      navigateTo(createdSlug)
    }
  }

  const deletePage = async function deletePage(): Promise<void> {
    if (!page) {
      return
    }
    /*
     * PROJ-807: the backend soft-deletes into a 30-day trash (undeleteWikiPage) —
     * this used to claim the opposite.
     */
    if (
      !window.confirm(
        `Delete "${page.title}"? The page (and any children) will move to trash for 30 days. You can undo this right after, or restore it from the trash later.`,
      )
    ) {
      return
    }
    const deletedPage = page
    try {
      /* The cascade=true option trashes the children together with the page under one
       * trash_batch_id — which is what the dialog promises, and what lets Undo bring
       * the whole subtree back. Without it the API re-parents the children one level
       * up instead, and undelete could only restore the page on its own. */
      unwrapResult(await trashWikiPage({ workspaceSlug, slug: page.slug }))
      setPage(null)
      setSlug('')

      showUndoToast({
        id: crypto.randomUUID(),
        message: `"${deletedPage.title}" moved to trash.`,
        undo: async () => (await undeleteWikiPage(deletedPage.id, workspaceSlug)).slug,
        afterUndo: async (restoredSlug) => {
          navigateTo(restoredSlug || deletedPage.slug)
        },
      })
    } catch (caughtError) {
      alert(`Delete failed: ${globalThis.String(caughtError)}`)
    }
  }

  return { navigateTo, startCreate, submitCreate, deletePage }
}

const WIKI_PAGE_STYLES = `
	.wiki-link-broken {
		color: var(--text-muted);
		text-decoration: underline;
		text-decoration-style: dashed;
		text-underline-offset: 2px;
	}
	.wiki-link-broken a {
		font-size: 0.8em;
		margin-left: 0.2em;
		color: var(--text-muted);
		text-decoration: none;
		border: 1px solid var(--border);
		border-radius: 3px;
		padding: 0 3px;
	}
	.wiki-link-broken a:hover {
		color: var(--accent);
		border-color: var(--accent);
	}
	.prose pre.mermaid {
		display: flex;
		justify-content: center;
		background: none;
		padding: 0;
	}
	.prose pre.mermaid svg {
		max-width: 100%;
		width: auto;
		height: auto;
	}
	/* PROJ-612: renderMdWithWikilinks (markdown.ts) wraps every rendered <table> in
	 * a .table-scroll div (PROJ-605), but this page never defined the scroll rule
	 * for it — unlike IssueDetailParts.tsx and share/view.astro, a wide table here
	 * had no horizontal scroll boundary at all. */
	.prose .table-scroll {
		overflow-x: auto;
	}
	@media (max-width: 640px) {
		.wiki-breadcrumb button {
			max-width: 8rem;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}

	/* PROJ-664: the page tree/filters sidebar becomes an off-canvas drawer below
	 * 640px instead of stacking full-width above the article — mirrors the
	 * app-wide sidebar drawer in Base.astro (hamburger + overlay + transform),
	 * scoped here to the wiki page tree only. The trigger button's presence is
	 * gated in JS (useIsMobileViewport), not CSS display:none — matchMedia is
	 * mockable in tests, but jsdom's own @media evaluation isn't. */
	.wiki-drawer-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 44px;
		margin: 0.5rem 0.5rem 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface);
		color: var(--text-base);
		font-size: 0.875rem;
		cursor: pointer;
	}
	.wiki-drawer-overlay { display: none; }
	@media (max-width: 640px) {
		.wiki-sidebar {
			position: fixed;
			top: var(--topbar-height, 0px);
			left: 0;
			bottom: 0;
			width: min(82vw, 280px);
			max-width: 280px;
			transform: translateX(-100%);
			/* PROJ-806: translateX alone leaves the closed drawer keyboard/screen-reader
			   reachable (it's still in the layout, just off-screen) — visibility:hidden
			   (paired with the inert attribute set in JS below) takes it out of both. */
			visibility: hidden;
			/* Delay the switch to hidden until the slide-out has finished, or the drawer
			   vanishes instantly on close instead of sliding away. */
			transition: transform 0.22s ease, visibility 0s linear 0.22s;
			/* Keep the page-tree drawer and its shadow below the shell header (z40).
			   The app-wide Base UI Sheet remains a separate, full-height modal above it. */
			z-index: 31;
			box-shadow: none;
		}
		.wiki-sidebar.wiki-sidebar-open {
			transform: translateX(0);
			visibility: visible;
			/* …but become visible immediately on open, so the slide-in is seen. */
			transition: transform 0.22s ease, visibility 0s linear 0s;
			box-shadow: 0 0 40px rgba(0, 0, 0, 0.35);
		}
		.wiki-drawer-overlay {
			display: block;
			position: fixed;
			inset: var(--topbar-height, 0px) 0 0;
			background: rgba(0, 0, 0, 0.45);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.22s ease;
			z-index: 30;
		}
		.wiki-drawer-overlay.wiki-drawer-overlay-open {
			opacity: 1;
			pointer-events: auto;
		}
	}

	/* PROJ-664: action row no longer force-shrinks the title on mobile — the
	 * overflow menu keeps it to two buttons (Edit + ⋯), so it can wrap onto
	 * its own line instead of crushing the h1. */
	@media (max-width: 640px) {
		.wiki-page-header {
			flex-wrap: wrap;
		}
	}

	.page-action-menu-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		min-height: 44px;
		border: none;
		background: none;
		color: var(--text-base);
		font-size: 0.875rem;
		cursor: pointer;
		border-radius: 4px;
	}
	.page-action-menu-item:hover { background: var(--surface); }
	.page-action-menu-item-danger { color: var(--danger-text); }
`

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function WikiPageShell(
  props: Readonly<{
    workspaceSlug: string | undefined
    projectId: string
    searchQuery: string
    onSearchQueryChange: (nextQuery: string) => void
    searchResults: SearchResult[]
    searchLoading: boolean
    treeLoading: boolean
    pageTree: TreeNode[]
    slug: string
    onNavigate: (slug: string) => void
    onCreate: () => void
    filters: ReturnType<typeof useWikiFilters>
    stale: ReturnType<typeof useWikiStalePages>
    mainContentProps: {
      creating: boolean
      createProps: CreateFormProps
      slug: string
      loading: boolean
      error: string | null
      page: WikiPageData | null
      articleProps: Omit<PageArticleProps, 'page'>
    }
  }>,
): JSX.Element {
  const { close, open, setOpen, triggerRef, sidebarRef } = useWikiSidebarDrawer()
  const { onNavigate, onCreate } = props
  const isMobile = useIsMobileViewport()
  /*
   * PROJ-664: picking a page or starting a create must close the drawer, or
   * tapping a page in the tree leaves the drawer covering the page just opened.
   */
  const navigateAndClose = useCallback(
    (slug: string) => {
      close()
      onNavigate(slug)
    },
    [close, onNavigate],
  )
  const createAndClose = useCallback(() => {
    close()
    onCreate()
  }, [close, onCreate])

  return (
    <div className='flex min-h-screen max-sm:flex-col'>
      <style>{WIKI_PAGE_STYLES}</style>
      {isMobile && (
        <button
          type='button'
          ref={triggerRef}
          className='wiki-drawer-trigger'
          aria-expanded={open}
          aria-controls='wiki-page-tree'
          onClick={() => {
            setOpen((currentlyOpen) => !currentlyOpen)
          }}
        >
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden='true'
          >
            <line x1='3' y1='6' x2='21' y2='6' />
            <line x1='3' y1='12' x2='21' y2='12' />
            <line x1='3' y1='18' x2='21' y2='18' />
          </svg>
          Pages
        </button>
      )}
      <div
        className={`wiki-drawer-overlay ${open ? 'wiki-drawer-overlay-open' : ''}`}
        aria-hidden='true'
        onClick={close}
      />
      <WikiSidebar
        workspaceSlug={props.workspaceSlug}
        projectId={props.projectId}
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        searchResults={props.searchResults}
        searchLoading={props.searchLoading}
        treeLoading={props.treeLoading}
        pageTree={props.pageTree}
        slug={props.slug}
        onNavigate={navigateAndClose}
        onCreate={createAndClose}
        filterType={props.filters.filterType}
        onFilterTypeChange={props.filters.setFilterType}
        typeOptions={props.filters.typeOptions}
        filterStatus={props.filters.filterStatus}
        onFilterStatusChange={props.filters.setFilterStatus}
        filterTags={props.filters.filterTags}
        onFilterTagsChange={props.filters.setFilterTags}
        hasActiveFilters={props.filters.hasActiveFilters}
        filteredResults={props.filters.filteredResults}
        filteredLoading={props.filters.filteredLoading}
        staleOpen={props.stale.staleOpen}
        onToggleStale={props.stale.setStaleOpen}
        stalePages={props.stale.stalePages}
        staleLoading={props.stale.staleLoading}
        drawerOpen={open}
        isMobile={isMobile}
        sidebarRef={sidebarRef}
      />

      <main className='flex-1 p-8 max-sm:p-4 min-w-0'>
        <WikiMainContent {...props.mainContentProps} />
      </main>
    </div>
  )
}

function deriveWikiPageState(
  pageData: ReturnType<typeof useWikiPageData>,
  pageMap: Record<string, FlatEntry>,
  /*
   * PROJ-860: passed in (memoised on [pageMap]) rather than recomputed here, so its
   * identity stays stable across renders this function runs on but pageMap doesn't change.
   */
  wikiPages: Readonly<FlatEntry[]>,
  editState: ReturnType<typeof useWikiEditing>,
  createForm: ReturnType<typeof useCreatePageForm>,
  toc: Readonly<TocItem[]>,
) {
  const latestRevision = pageData.revisions[0] ?? null
  // Breadcrumbs for current page (PROJ-114)
  const breadcrumbs = pageData.page ? getBreadcrumbs(pageData.page.id, pageMap) : []
  // ToC sidebar (PROJ-113) — only when viewing page, ≥3 headings
  const showToc = !editState.editing && !createForm.creating && toc.length >= MIN_TOC_ENTRIES
  const createParentTitle = createForm.createParentId ? (pageMap[createForm.createParentId]?.title ?? null) : null
  const moveOptions: SelectOption[] = [
    { value: '', label: 'No parent (root)' },
    ...wikiPages
      .filter((candidatePage) => candidatePage.id !== pageData.page?.id)
      .map((candidatePage) => ({ value: candidatePage.id, label: candidatePage.title })),
  ]
  return { latestRevision, breadcrumbs, showToc, createParentTitle, moveOptions }
}

function buildCreateFormProps(
  create: Readonly<{
    createParentTitle: string | null
    createTitle: string
    createSlug: string
    createContent: string
    createError: string | undefined
    createSaving: boolean
    templates: TemplateOption[]
    createTemplateSlug: string
    onCreateTitleChange: (title: string) => void
    onCreateSlugChange: (slug: string) => void
    setCreateContent: (content: string) => void
    onCreateTemplateChange: (templateSlug: string) => void
    submitCreate: () => void
    cancelCreate: () => void
  }>,
): CreateFormProps {
  return {
    parentTitle: create.createParentTitle,
    title: create.createTitle,
    slug: create.createSlug,
    content: create.createContent,
    error: create.createError,
    saving: create.createSaving,
    templates: create.templates,
    templateSlug: create.createTemplateSlug,
    onTitleChange: create.onCreateTitleChange,
    onSlugChange: create.onCreateSlugChange,
    onContentChange: create.setCreateContent,
    onTemplateChange: create.onCreateTemplateChange,
    onSubmit: create.submitCreate,
    onCancel: create.cancelCreate,
  }
}

function buildArticleProps(
  article: Readonly<{
    breadcrumbs: FlatEntry[]
    navigateTo: (slug: string) => void
    showToc: boolean
    toc: TocItem[]
    activeHeadingId: string
    setContentRef: (node: HTMLDivElement | null) => void
    editing: boolean
    editTitle: string
    setEditTitle: (title: string) => void
    saving: boolean
    save: () => void
    cancelEdit: () => void
    startEdit: () => void
    startCreate: (parentId: string | null) => void
    deletePage: () => void
    onVerify: () => void
    verifying: boolean
    verifyError: string | undefined
    latestRevision: WikiRevision | null
    saveError: string | undefined
    overwriteWithMine: (() => void) | null
    draftBanner: ServerDraft | null
    draftWarning: string | undefined
    restoreDraft: () => void
    discardDraft: () => void
    editContent: string
    setEditContent: (content: string) => void
    renderedHtml: string
    revisions: WikiRevision[]
    showHistory: boolean
    setShowHistory: (updater: (isShown: boolean) => boolean) => void
    onRestoreRevision: (revision: WikiRevision) => void
    restoringRevisionId: string | undefined
    attach: ReturnType<typeof useWikiAttachments>
    workspaceSlug: string | undefined
    move: ReturnType<typeof useMovePage>
    moveOptions: SelectOption[]
  }>,
): Omit<PageArticleProps, 'page'> {
  return {
    breadcrumbs: article.breadcrumbs,
    onNavigate: article.navigateTo,
    showToc: article.showToc,
    toc: article.toc,
    activeHeadingId: article.activeHeadingId,
    setContentRef: article.setContentRef,
    editing: article.editing,
    editTitle: article.editTitle,
    onEditTitleChange: article.setEditTitle,
    saving: article.saving,
    onSave: article.save,
    onCancelEdit: article.cancelEdit,
    onStartEdit: article.startEdit,
    onStartCreateChild: article.startCreate,
    onDelete: article.deletePage,
    onVerify: article.onVerify,
    verifying: article.verifying,
    verifyError: article.verifyError,
    latestRevision: article.latestRevision,
    saveError: article.saveError,
    onOverwriteWithMine: article.overwriteWithMine,
    draftBanner: article.draftBanner,
    draftWarning: article.draftWarning,
    onRestoreDraft: article.restoreDraft,
    onDiscardDraft: article.discardDraft,
    editContent: article.editContent,
    onEditContentChange: article.setEditContent,
    renderedHtml: article.renderedHtml,
    revisions: article.revisions,
    showHistory: article.showHistory,
    onToggleHistory: () => {
      article.setShowHistory((isShown) => !isShown)
    },
    onRestoreRevision: article.onRestoreRevision,
    restoringRevisionId: article.restoringRevisionId,
    attachments: article.attach.attachments,
    workspaceSlug: article.workspaceSlug,
    uploadFormOpen: article.attach.uploadFormOpen,
    uploadError: article.attach.uploadError,
    onToggleUploadForm: article.attach.setUploadFormOpen,
    onCancelUpload: article.attach.cancelUpload,
    onDeleteAttachment: article.attach.deleteAttachment,
    onUploadInlineImage: article.attach.uploadInlineImage,
    moving: article.move.moving,
    moveOptions: article.moveOptions,
    moveTargetId: article.move.moveTargetId,
    moveSaving: article.move.moveSaving,
    moveError: article.move.moveError,
    onStartMove: article.move.startMove,
    onMoveTargetChange: article.move.setMoveTargetId,
    onSubmitMove: article.move.submitMove,
    onCancelMove: article.move.cancelMove,
  }
}

function useWikiPageState(
  workspaceSlug: string | undefined,
  projectIdProp: string | undefined,
  slugProp: string | undefined,
) {
  const { slug, setSlug } = useWikiUrlState(slugProp)
  const scope = useWikiScope(workspaceSlug, projectIdProp)
  const projectId = scope ?? ''
  // PROJ-807: the "moved to trash" Undo toast shown after a delete.
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null)
  const { pageTree, pageMap, treeLoading } = useWikiTree(workspaceSlug, scope)
  const filters = useWikiFilters(workspaceSlug, scope, pageTree)
  const stale = useWikiStalePages(workspaceSlug, scope)
  const { searchQuery, setSearchQuery, searchResults, searchLoading } = useWikiSearch(workspaceSlug, scope, {
    filterType: filters.filterType,
    filterStatus: filters.filterStatus,
    filterTags: filters.filterTags,
  })

  // Keep the title map stable for local preview options.
  const wikiPages = useMemo(() => Object.values(pageMap), [pageMap])

  const pageData = useWikiPageData(workspaceSlug, slug)

  const renderedMarkdown = useRenderedPageMarkdown(pageData.page?.content, wikiPages)
  const renderedHtml = renderedMarkdown.html
  const { toc, activeHeadingId } = useTableOfContents(
    pageData.page,
    pageData.contentRef,
    renderedMarkdown,
    pageData.contentMountToken,
  )
  useHashScroll(toc, pageData.contentRef, pageData.page?.slug)
  const attach = useWikiAttachments(workspaceSlug, pageData.page)
  const editState = useWikiEditing(
    workspaceSlug,
    pageData.page,
    pageData.revisionsLoaded ? (pageData.revisions[0]?.id ?? null) : undefined,
  )
  const createForm = useCreatePageForm(workspaceSlug, projectId)
  const wikiTemplates = useWikiTemplates(workspaceSlug)
  const move = useMovePage(workspaceSlug, pageData.page)
  const verify = useWikiVerify(workspaceSlug, pageData.page)
  const restoreState = useWikiRestore(
    workspaceSlug,
    pageData.page,
    pageData.revisionsLoaded ? (pageData.revisions[0]?.id ?? null) : undefined,
    editState.editing,
  )

  return {
    slug,
    setSlug,
    projectId,
    pageTree,
    pageMap,
    treeLoading,
    filters,
    stale,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    pageData,
    wikiPages,
    renderedHtml,
    toc,
    activeHeadingId,
    attach,
    editState,
    createForm,
    wikiTemplates,
    move,
    verify,
    restoreState,
    undoToast,
    setUndoToast,
  }
}

function useAssembledWikiPageProps(state: ReturnType<typeof useWikiPageState>, workspaceSlug?: string) {
  const seed = useWikiSeed()
  const {
    setSlug,
    pageMap,
    pageData,
    wikiPages,
    renderedHtml,
    toc,
    activeHeadingId,
    attach,
    editState,
    createForm,
    wikiTemplates,
    move,
    verify,
    restoreState,
    setUndoToast,
  } = state

  const { navigateTo, startCreate, submitCreate, deletePage } = createWikiActions({
    workspaceSlug,
    page: pageData.page,
    setSlug,
    setEditing: editState.setEditing,
    flushDraftNow: editState.flushDraftNow,
    setPage: pageData.setPage,
    rawStartCreate: createForm.startCreate,
    rawSubmitCreate: createForm.submitCreate,
    cancelMove: move.cancelMove,
    showUndoToast: setUndoToast,
    navigate: (path: string) => {
      navigateFeature(wikiHref(seed, path))
    },
  })

  const { latestRevision, breadcrumbs, showToc, createParentTitle, moveOptions } = deriveWikiPageState(
    pageData,
    pageMap,
    wikiPages,
    editState,
    createForm,
    toc,
  )

  const startEdit = function startEdit(): void {
    move.cancelMove()
    void editState.startEdit()
  }

  const createProps = buildCreateFormProps({
    createParentTitle,
    createTitle: createForm.createTitle,
    createSlug: createForm.createSlug,
    createContent: createForm.createContent,
    createError: createForm.createError,
    createSaving: createForm.createSaving,
    templates: wikiTemplates,
    createTemplateSlug: createForm.createTemplateSlug,
    onCreateTitleChange: createForm.onCreateTitleChange,
    onCreateSlugChange: createForm.onCreateSlugChange,
    setCreateContent: createForm.setCreateContent,
    onCreateTemplateChange: createForm.onCreateTemplateChange,
    submitCreate,
    cancelCreate: createForm.cancelCreate,
  })

  const articleProps = buildArticleProps({
    breadcrumbs,
    navigateTo,
    showToc,
    toc,
    activeHeadingId,
    setContentRef: pageData.setContentRef,
    editing: editState.editing,
    editTitle: editState.editTitle,
    setEditTitle: editState.setEditTitle,
    saving: editState.saving,
    save: editState.save,
    cancelEdit: editState.cancelEdit,
    startEdit,
    startCreate,
    deletePage,
    onVerify: verify.verifyPage,
    verifying: verify.verifying,
    verifyError: verify.verifyError,
    latestRevision,
    saveError: editState.saveError,
    overwriteWithMine: editState.overwriteWithMine,
    draftBanner: editState.draftBanner,
    draftWarning: editState.draftWarning,
    restoreDraft: editState.restoreDraft,
    discardDraft: editState.discardDraft,
    editContent: editState.editContent,
    setEditContent: editState.setEditContent,
    renderedHtml,
    revisions: pageData.revisions,
    showHistory: pageData.showHistory,
    setShowHistory: pageData.setShowHistory,
    onRestoreRevision: restoreState.restore,
    restoringRevisionId: restoreState.restoringId,
    attach,
    workspaceSlug,
    move,
    moveOptions,
  })

  return { navigateTo, startCreate, createProps, articleProps }
}

/*
 * PROJ-807: shown after deleting a page. No existing toast utility in apps/web/src —
 * this is deliberately minimal (a fixed-position bar, not a general-purpose stack)
 * rather than introducing a new shared abstraction for a single call site.
 */
const UNDO_TOAST_TIMEOUT_MS = 8000

/*
 * Each toast gets its own UndoToastBar instance (keyed when deletion succeeds), so undo/hover/
 * focus state always starts fresh — no reset effect that could race a hover or focus
 * arriving before it runs.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function UndoToastView({
  toast,
  onDismiss,
}: {
  toast: UndoToast | null
  onDismiss: () => void
}): undefined | JSX.Element {
  if (!toast) {
    return undefined
  }
  return <UndoToastBar key={toast.id} toast={toast} onDismiss={onDismiss} />
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function UndoToastBar({ toast, onDismiss }: { toast: UndoToast; onDismiss: () => void }): JSX.Element {
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string>()
  const [hovered, setHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  /*
   * Don't pull the toast out from under someone who is reading it, reaching for Undo
   * with a keyboard, or waiting on an Undo already in progress. Any of those resets the
   * countdown; it restarts in full once they're all false again.
   */
  const paused = undoing || hovered || focusWithin

  useEffect(() => {
    if (paused) {
      return
    }
    const timer = setTimeout(onDismiss, UNDO_TOAST_TIMEOUT_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [paused, onDismiss])

  const current = toast

  const handleUndo = async function handleUndo(): Promise<void> {
    setUndoing(true)
    setUndoError(undefined)
    let result: string
    try {
      result = await current.undo()
    } catch (caughtError) {
      setUndoError(`Undo failed: ${globalThis.String(caughtError)}`)
      setUndoing(false)
      return
    }
    onDismiss()
    try {
      await current.afterUndo?.(result)
    } catch {
      // The undo itself succeeded — a failed refresh afterwards isn't an undo failure.
    }
  }

  return (
    <div
      role='status'
      className={[
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3',
        'bg-surface border border-border rounded shadow-lg px-4 py-3 text-sm text-text-base',
      ].join(' ')}
      onMouseEnter={() => {
        setHovered(true)
      }}
      onMouseLeave={() => {
        setHovered(false)
      }}
      onFocus={() => {
        setFocusWithin(true)
      }}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setFocusWithin(false)
        }
      }}
    >
      <span>{undoError ?? current.message}</span>
      {(Predicate.isNullish(undoError) || String.isEmpty(undoError)) && (
        <Button variant='outline' size='sm' onClick={handleUndo} disabled={undoing}>
          {undoing ? 'Undoing…' : 'Undo'}
        </Button>
      )}
      <button
        type='button'
        aria-label='Dismiss'
        className='bg-transparent border-none cursor-pointer text-text-muted'
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiPageClient({ initial }: Readonly<{ initial: WikiSeed }>): JSX.Element {
  return (
    <SeedContext.Provider value={initial}>
      <WikiPageContent
        key={`${initial.workspaceSlug}:${initial.projectId}:${initial.slug}:${initial.mode}`}
        workspaceSlug={initial.workspaceSlug}
        projectId={initial.projectId}
        slug={initial.slug}
      />
    </SeedContext.Provider>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function WikiPageContent({ workspaceSlug, projectId: projectIdProp, slug: slugProp }: Props): JSX.Element {
  const seed = useWikiSeed()
  const state = useWikiPageState(workspaceSlug, projectIdProp, slugProp)
  const {
    slug,
    projectId,
    pageTree,
    treeLoading,
    filters,
    stale,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    pageData,
    createForm,
    undoToast,
    setUndoToast,
  } = state
  const { navigateTo, startCreate, createProps, articleProps } = useAssembledWikiPageProps(state, workspaceSlug)
  const dismissUndoToast = useCallback(() => {
    setUndoToast(null)
  }, [setUndoToast])

  return (
    <>
      <WikiPageShell
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
        treeLoading={treeLoading}
        pageTree={pageTree}
        slug={slug}
        onNavigate={navigateTo}
        onCreate={() => {
          startCreate(null)
        }}
        filters={filters}
        stale={stale}
        mainContentProps={{
          creating: createForm.creating,
          createProps,
          slug,
          loading: pageData.loading,
          error: pageData.error,
          page: pageData.page,
          articleProps,
        }}
      />
      <UndoToastView toast={undoToast} onDismiss={dismissUndoToast} />
      {pageData.page && (
        <>
          <title>{`${pageData.page.title} - ${seed.brandName} Wiki`}</title>
          <meta property='og:title' content={pageData.page.title} />
          <meta property='og:description' content={excerptOf(pageData.page.content)} />
          <meta property='og:url' content={wikiHref(seed, `/wiki/${encodeURIComponent(pageData.page.slug)}`)} />
        </>
      )}
    </>
  )
}
