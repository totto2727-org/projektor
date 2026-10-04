"use client";

import { query } from "@effront/core/query";
import { useForm, useStore } from "@tanstack/react-form";
import { Effect, Schema } from "effect";
import {
	createContext,
	Fragment,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { uploadInlineImage as uploadEditorImage } from "../../attachment-actions";
import { FunctionError, unwrapResult } from "../../client/functions";
import { AttachmentUpload } from "../../components/AttachmentUpload";
import { FormErrors } from "../../components/FormErrors";
import { Button } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import Select, { type SelectOption } from "../../components/ui/Select";
import { formatTimestamp, formatTimestampDate } from "../timestamp";
import {
	createWikiPage,
	deleteWikiAttachment,
	discardWikiDraft,
	duplicateWikiPage,
	getWikiDraft,
	getWikiPage,
	getWikiRevisionDiff,
	moveWikiPage,
	restoreTrashedWikiPage,
	restoreWikiRevision,
	saveWikiDraft,
	saveWikiPage,
	trashWikiPage,
	verifyWikiPage,
} from "./actions";
import {
	AttachmentFields,
	CreateFields,
	EditFields,
	FilterFields,
	MoveFields,
	SearchFields,
} from "./form-schemas";
import { decorateHeadings } from "./headings";
import MarkdownEditor from "./LazyMarkdownEditor";
import { navigateFeature } from "./navigation";
import { renderMdWithWikilinks, renderMermaidDiagrams, stripFrontmatter } from "./render-markdown";

export { assignHeadingIds } from "./headings";

interface ProjectOption {
	id: string;
	key: string;
	name: string;
	workspace_slug: string;
}
export interface WikiSeed {
	page: WikiPageData | null;
	tree: TreeNode[];
	revisions: WikiRevision[];
	attachments: Attachment[];
	templates: TemplateOption[];
	projects: ProjectOption[];
	stalePages: StalePageItem[];
	filteredPages: WikiListItem[];
	searchResults: SearchResult[];
	draft: ServerDraft | null;
	draftStatus: DraftStatus;
	workspaceSlug: string;
	projectId: string;
	slug: string;
	filterType: string;
	filterStatus: string;
	filterTags: string;
	searchQuery: string;
	createTitle: string;
	mode: "read" | "create" | "edit";
	publicViewer: boolean;
	brandName: string;
}
const SeedContext = createContext<WikiSeed | null>(null);
function useWikiSeed(): WikiSeed {
	const seed = useContext(SeedContext);
	if (!seed) throw new Error("Wiki server DTO is required.");
	return seed;
}
function usePublicViewer(_workspaceSlug?: string): boolean {
	return useWikiSeed().publicViewer;
}
function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
function safeDecodeURIComponent(raw: string): string | null {
	try {
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}
function wikiHref(seed: Pick<WikiSeed, "workspaceSlug" | "projectId">, path: string): string {
	const url = new URL(path, "https://wiki.invalid");
	url.searchParams.set("workspace", seed.workspaceSlug);
	if (seed.projectId) url.searchParams.set("projectId", seed.projectId);
	else url.searchParams.set("scope", "workspace");
	return `${url.pathname}${url.search}${url.hash}`;
}
async function undeleteWikiPage(id: string, workspaceSlug?: string): Promise<{ slug: string }> {
	return unwrapResult(await restoreTrashedWikiPage({ pageId: id, workspaceSlug }));
}

/** Matches Base.astro's mobile `@media (max-width: 640px)` breakpoint. */
const WIKI_MOBILE_QUERY = "(max-width: 640px)";

// PROJ-664: reactive (unlike Select.tsx's imperative isMobileMenu() check) since
// the wiki reader switches whole sections of the layout on crossing the
// breakpoint, not just a menu opened on demand.
function useIsMobileViewport(): boolean {
	const [isMobile, setIsMobile] = useState(false);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const mq = window.matchMedia(WIKI_MOBILE_QUERY);
		setIsMobile(mq.matches);
		const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return isMobile;
}

// PROJ-491 (R9): the create-form's template picker draws from list_wiki_templates.
interface TemplateOption {
	id: string;
	slug: string;
	title: string;
}

// PROJ-489 (R7): computed/derived at read time, never stored — null when the page has
// no verify_interval/status frontmatter signal at all.
interface WikiFreshness {
	state: "fresh" | "stale" | "unverified";
	staleSince: number | null;
}

interface SearchResult {
	id: string;
	slug: string;
	title: string;
	project_id: string | null;
	excerpt: string | null;
	// PROJ-488 (R6): denormalized frontmatter metadata, surfaced as chips in search results.
	type: string | null;
	status: string | null;
	tags: string[];
	// PROJ-489 (R7): search demotes stale/deprecated results — surfaced here so the UI
	// can show why a result ranks low.
	freshness: WikiFreshness | null;
}

export interface WikiPageData {
	id: string;
	slug: string;
	title: string;
	content: string;
	// PROJ-809: revision pointer for exactly this content (undefined from older servers).
	revisionId?: string | null;
	project_id?: string | null;
	parent_id: string | null;
	updated_at: number;
	// PROJ-488 (R6): optional YAML frontmatter, denormalized on the API side.
	type: string | null;
	tags: string[];
	status: string | null;
	verified_at: number | null;
	verified_by: string | null;
	owners: string[];
	verify_interval: number | null;
	// PROJ-489 (R7): computed freshness, surfaced in the page header.
	freshness: WikiFreshness | null;
}

// PROJ-489 (R7): the list_stale_pages maintenance queue shape.
interface StalePageItem {
	id: string;
	slug: string;
	title: string;
	freshness: WikiFreshness | null;
}

// PROJ-488: shape returned by GET /api/wiki (listWikiPages) — used for the sidebar's
// type/status/tags filtered browse view (WikiSidebar's flat list, distinct from the
// hierarchical tree shown when no filter is active).
interface WikiListItem {
	id: string;
	slug: string;
	title: string;
	type: string | null;
	status: string | null;
	tags: string[];
}

const WIKI_TYPE_FILTER_OPTIONS: SelectOption[] = [
	{ value: "", label: "All types" },
	{ value: "runbook", label: "Runbook" },
	{ value: "adr", label: "ADR" },
	{ value: "spec", label: "Spec" },
	{ value: "note", label: "Note" },
];

const WIKI_WELL_KNOWN_TYPES = new Set(WIKI_TYPE_FILTER_OPTIONS.map((o) => o.value).filter(Boolean));

// PROJ-514: frontmatter `type` is freeform (PROJ-513) — merge in any other distinct
// types actually present in the workspace so pages using e.g. `type: whitepaper` stay
// discoverable, without losing the well-known values' friendly labels/ordering. Dedupe
// case-insensitively (frontmatter `type` is never case-normalized) so e.g. `Runbook`
// doesn't produce a second, visually-indistinguishable entry alongside the well-known
// lowercase `runbook`.
function buildTypeFilterOptions(discoveredTypes: readonly string[]): SelectOption[] {
	const seen = new Set(Array.from(WIKI_WELL_KNOWN_TYPES).map((t) => t.toLowerCase()));
	const extras: string[] = [];
	for (const t of discoveredTypes) {
		if (!t) continue;
		const key = t.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		extras.push(t);
	}
	extras.sort((a, b) => a.localeCompare(b));
	return [...WIKI_TYPE_FILTER_OPTIONS, ...extras.map((t) => ({ value: t, label: t }))];
}

const WIKI_STATUS_FILTER_OPTIONS: SelectOption[] = [
	{ value: "", label: "All statuses" },
	{ value: "draft", label: "Draft" },
	{ value: "current", label: "Current" },
	{ value: "stale", label: "Stale" },
	{ value: "deprecated", label: "Deprecated" },
];

const WIKI_STATUS_PILL_STYLE: Record<string, { bg: string; color: string }> = {
	draft: { bg: "var(--priority-low-bg)", color: "var(--priority-low-text)" },
	current: { bg: "var(--status-done-bg)", color: "var(--status-done)" },
	stale: { bg: "var(--priority-high-bg)", color: "var(--priority-high-text)" },
	deprecated: { bg: "var(--danger-bg)", color: "var(--danger-text)" },
};

function WikiStatusPill({ status }: { status: string }) {
	const style = WIKI_STATUS_PILL_STYLE[status] ?? {
		bg: "var(--priority-low-bg)",
		color: "var(--priority-low-text)",
	};
	return (
		<span
			className="inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold uppercase tracking-wide"
			style={{ background: style.bg, color: style.color }}
		>
			{status}
		</span>
	);
}

// PROJ-489 (R7): "fresh" renders nothing — only stale/unverified pages need a visual
// nudge; a page with no freshness signal at all (`null`) also renders nothing (handled
// by the caller, not this component).
const WIKI_FRESHNESS_BADGE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
	stale: { bg: "var(--priority-high-bg)", color: "var(--priority-high-text)", label: "Stale" },
	unverified: {
		bg: "var(--priority-low-bg)",
		color: "var(--priority-low-text)",
		label: "Unverified",
	},
};

function WikiFreshnessBadge({ state }: { state: WikiFreshness["state"] }) {
	const style = WIKI_FRESHNESS_BADGE_STYLE[state];
	if (!style) return null;
	return (
		<span
			className="inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold uppercase tracking-wide"
			style={{ background: style.bg, color: style.color }}
		>
			{style.label}
		</span>
	);
}

const WIKI_TAG_CHIP_CLASS =
	"inline-flex items-center px-2 py-[0.1rem] mr-1 mb-1 rounded-full text-[0.72rem] " +
	"bg-bg border border-border text-text-base";

function TagChips({ tags }: { tags: string[] | undefined | null }) {
	if (!Array.isArray(tags) || tags.length === 0) return null;
	return (
		<span className="inline-flex flex-wrap align-middle">
			{tags.map((t) => (
				<span key={t} className={WIKI_TAG_CHIP_CLASS}>
					{t}
				</span>
			))}
		</span>
	);
}

// PROJ-488: header card summarizing a page's frontmatter metadata (type/status/tags/
// owners/verification). Omitted entirely for a page with no frontmatter at all, so
// pages predating this feature (or that simply don't use it) render exactly as before.
//
// PROJ-489 (R7): the Verify button/freshness badge only render when the page has opted
// into verification tracking (a verify_interval or a status set) — a page with neither
// has freshness: null and nothing meaningful to verify against.
function WikiMetadataBadges({ page }: { page: WikiPageData }) {
	return (
		<>
			{page.type && (
				<span
					className={
						"inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold " +
						"uppercase tracking-wide bg-bg border border-border text-text-muted"
					}
				>
					{page.type}
				</span>
			)}
			{page.status && <WikiStatusPill status={page.status} />}
			{page.freshness && page.freshness.state !== "fresh" && (
				<WikiFreshnessBadge state={page.freshness.state} />
			)}
			<TagChips tags={page.tags} />
			{page.owners.length > 0 && <span>Owners: {page.owners.join(", ")}</span>}
			{page.verified_at && (
				<span>
					Verified {formatTimestampDate(page.verified_at)}
					{page.verified_by ? ` by ${page.verified_by}` : ""}
				</span>
			)}
		</>
	);
}

function WikiVerifyControls({
	hasVerificationSignal,
	onVerify,
	verifying,
	verifyError,
	isPublicViewer,
}: {
	hasVerificationSignal: boolean;
	onVerify: () => void;
	verifying: boolean;
	verifyError: string | null;
	isPublicViewer: boolean;
}) {
	return (
		<>
			{hasVerificationSignal && !isPublicViewer && (
				<Button variant="outline" size="sm" onClick={onVerify} disabled={verifying}>
					{verifying ? "Verifying…" : "Verify"}
				</Button>
			)}
			{verifyError && (
				<span role="alert" className="text-danger-text">
					{verifyError}
				</span>
			)}
		</>
	);
}

function WikiMetadataCard({
	page,
	onVerify,
	verifying,
	verifyError,
	isPublicViewer,
}: {
	page: WikiPageData;
	onVerify: () => void;
	verifying: boolean;
	verifyError: string | null;
	isPublicViewer: boolean;
}) {
	const hasMetadata =
		Boolean(page.type) ||
		Boolean(page.status) ||
		page.tags.length > 0 ||
		page.owners.length > 0 ||
		Boolean(page.verified_at);
	const hasVerificationSignal = Boolean(page.verify_interval) || Boolean(page.status);
	if (!hasMetadata && !hasVerificationSignal) return null;

	return (
		<div
			className={
				"flex flex-wrap items-center gap-2 mb-4 p-3 border border-border rounded-lg " +
				"bg-surface text-[0.8rem] text-text-muted"
			}
		>
			<WikiMetadataBadges page={page} />
			<WikiVerifyControls
				hasVerificationSignal={hasVerificationSignal}
				onVerify={onVerify}
				verifying={verifying}
				verifyError={verifyError}
				isPublicViewer={isPublicViewer}
			/>
		</div>
	);
}

interface TreeNode {
	id: string;
	slug: string;
	title: string;
	type: string | null;
	children: TreeNode[];
}

interface FlatEntry {
	id: string;
	slug: string;
	title: string;
	parentId: string | null;
}

interface TocItem {
	level: number;
	text: string;
	id: string;
}

// PROJ-804: pure and exported so it's unit-testable without mounting WikiPage. Turns
// heading text into a URL-safe id and de-duplicates within one pass over the page's
// headings — repeated text (two "Overview" headings) gets `-1`, `-2`, … suffixes
// instead of two headings sharing an id (which broke the second TOC entry's link and
// its React/Preact list key). A heading whose text produces an empty slug (e.g. all
// punctuation, or a script `[^a-z0-9]` strips entirely) falls back to `section-N`
// (1-based, N = that heading's position) rather than `id=""`.
//
// Uniqueness is checked against every id handed out so far, not a per-base counter:
// ["Overview", "Overview", "Overview 1"] must not give `overview-1` twice, so a suffix
// is only taken once it's actually free. An id the author wrote (`<h2 id="install">`,
// which DOMPurify keeps) is reserved up front and left as-is — links elsewhere point
// at it — and generated ids steer around it. Only a *repeated* authored id is
// re-suffixed, since two elements can't share it either. Because kept ids are left
// alone, running this again over headings it already labelled is a no-op.
interface WikiRevision {
	id: string;
	author_id: string | null;
	author_name: string | null;
	created_at: number;
	summary: string | null;
}

// PROJ-807: state for the "page moved to trash" toast shown after a delete, with an
// Undo action wired to the existing trash-undelete endpoint.
interface UndoToast {
	message: string;
	/** The undo itself. Only a rejection here is reported as "Undo failed". */
	undo: () => Promise<string>;
	/**
	 * Best-effort follow-up once `undo` has succeeded (refresh the tree, go back to the
	 * page), given what `undo` resolved to. Its failures are swallowed: the page is
	 * already restored, so "Undo failed" would be false.
	 */
	afterUndo?: (result: string) => void | Promise<void>;
}

interface Attachment {
	id: string;
	filename: string;
	contentType: string;
	size: number;
	createdAt: number;
}

interface Props {
	workspaceSlug?: string;
	projectId?: string;
	slug?: string;
}

// PROJ-495 (R13): shape of a saved server-side draft (services/wiki-drafts.ts#getWikiDraft).
export interface ServerDraft {
	title: string;
	content: string;
	baseRevisionId: string | null;
	updatedAt: number;
	// PROJ-797 (client-only): the page was saved by someone since this draft started.
	pageChangedSince?: boolean;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// PROJ-514: walks the tree already fetched by useWikiTree to discover distinct `type`
// values for the sidebar filter dropdown, instead of issuing a second unfiltered fetch.
function collectTreeTypes(nodes: readonly TreeNode[]): string[] {
	const types: string[] = [];
	for (const node of nodes) {
		if (node.type) types.push(node.type);
		types.push(...collectTreeTypes(node.children));
	}
	return types;
}

function flattenTree(
	nodes: readonly TreeNode[],
	parentId: string | null = null
): Record<string, FlatEntry> {
	const map: Record<string, FlatEntry> = {};
	for (const node of nodes) {
		map[node.id] = { id: node.id, slug: node.slug, title: node.title, parentId };
		const childMap = flattenTree(node.children, node.id);
		for (const [k, v] of Object.entries(childMap)) map[k] = v;
	}
	return map;
}

function getBreadcrumbs(pageId: string, map: Record<string, FlatEntry>): FlatEntry[] {
	const crumbs: FlatEntry[] = [];
	let cur: FlatEntry | undefined = map[pageId];
	const seen = new Set<string>();
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id);
		crumbs.unshift(cur);
		cur = cur.parentId ? map[cur.parentId] : undefined;
	}
	return crumbs;
}

const TREE_ITEM_BASE_CLASS = [
	"block w-full text-left py-[0.375rem] px-2 rounded border-none cursor-pointer text-sm",
	"bg-transparent text-text-base hover:bg-border focus-visible:outline-2",
	"focus-visible:outline-accent focus-visible:outline-offset-2",
].join(" ");

function TreeNodeItem({
	node,
	currentSlug,
	depth,
	onNavigate,
}: {
	node: TreeNode;
	currentSlug: string;
	depth: number;
	onNavigate: (slug: string) => void;
}) {
	const isActive = currentSlug === node.slug;
	return (
		<li>
			<button
				type="button"
				className={`${TREE_ITEM_BASE_CLASS} ${isActive ? "!bg-accent !text-white font-semibold" : ""}`}
				style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
				onClick={() => onNavigate(node.slug)}
				aria-current={isActive ? "page" : undefined}
			>
				{depth > 0 && <span className="text-text-muted mr-1">{"›"}</span>}
				{node.title}
			</button>
			{node.children.length > 0 && (
				<ul className="list-none m-0 p-0">
					{node.children.map((child) => (
						<TreeNodeItem
							key={child.id}
							node={child}
							currentSlug={currentSlug}
							depth={depth + 1}
							onNavigate={onNavigate}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

// PROJ-486: search excerpts come back with `**match**` markers from the
// backend's FTS5 snippet() highlighting — split and render as <mark> instead
// of showing the literal asterisks.
function renderHighlightedExcerpt(excerpt: string) {
	const parts = excerpt.split(/(\*\*[^*]*\*\*)/g).filter((part) => part !== "");
	let offset = 0;
	return parts.map((part) => {
		const key = offset;
		offset += part.length;
		return part.startsWith("**") && part.endsWith("**") ? (
			<mark key={key} className="bg-accent-soft text-inherit rounded-xs">
				{part.slice(2, -2)}
			</mark>
		) : (
			<span key={key}>{part}</span>
		);
	});
}

const SEARCH_RESULT_BUTTON_CLASS = [
	"block w-full text-left py-[0.375rem] px-2 rounded border-none cursor-pointer text-sm",
	"bg-transparent text-text-base hover:bg-border focus-visible:outline-2",
	"focus-visible:outline-accent focus-visible:outline-offset-2",
].join(" ");

function SearchResultMetaLine({ r }: { r: SearchResult }) {
	const isStale = r.freshness && r.freshness.state !== "fresh";
	const show = r.type || r.status || (r.tags?.length ?? 0) > 0 || isStale;
	if (!show) return null;
	return (
		<span className="block mt-[0.15rem]">
			{r.status && <WikiStatusPill status={r.status} />}
			{isStale && r.freshness && <WikiFreshnessBadge state={r.freshness.state} />}
			<TagChips tags={r.tags} />
		</span>
	);
}

function SearchResultButton({
	r,
	onSelect,
}: {
	r: SearchResult;
	onSelect: (slug: string) => void;
}) {
	return (
		<button type="button" className={SEARCH_RESULT_BUTTON_CLASS} onClick={() => onSelect(r.slug)}>
			<span className="font-medium">{r.title}</span>
			<SearchResultMetaLine r={r} />
			{r.excerpt && (
				<span className="block text-[0.75rem] text-text-muted truncate">
					{renderHighlightedExcerpt(r.excerpt)}
				</span>
			)}
		</button>
	);
}

function SearchResultsList({
	loading,
	results,
	onSelect,
}: {
	loading: boolean;
	results: SearchResult[];
	onSelect: (slug: string) => void;
}) {
	if (loading) return <p className="text-[0.8rem] text-text-muted m-0">Searching…</p>;
	if (results.length === 0) return <p className="text-[0.8rem] text-text-muted m-0">No results</p>;
	return (
		<ul className="list-none m-0 p-0">
			{results.map((r) => (
				<li key={r.id}>
					<SearchResultButton r={r} onSelect={onSelect} />
				</li>
			))}
		</ul>
	);
}

// PROJ-489 (R7): the list_stale_pages maintenance queue — a simple flat list, matching
// FilteredPagesList's styling below (no existing "maintenance queue" UI precedent to
// follow elsewhere in this codebase).
function StalePagesList({
	loading,
	results,
	onSelect,
}: {
	loading: boolean;
	results: StalePageItem[];
	onSelect: (slug: string) => void;
}) {
	if (loading) return <p className="text-[0.8rem] text-text-muted m-0">Loading…</p>;
	if (results.length === 0)
		return <p className="text-[0.8rem] text-text-muted m-0">Nothing needs verification</p>;
	return (
		<ul className="list-none m-0 p-0">
			{results.map((r) => (
				<li key={r.id}>
					<button
						type="button"
						className={SEARCH_RESULT_BUTTON_CLASS}
						onClick={() => onSelect(r.slug)}
					>
						<span className="font-medium">{r.title}</span>
						{r.freshness && (
							<span className="block mt-[0.15rem]">
								<WikiFreshnessBadge state={r.freshness.state} />
							</span>
						)}
					</button>
				</li>
			))}
		</ul>
	);
}

// PROJ-488: flat, non-hierarchical list shown in the sidebar when a type/status/tag
// filter is active — filtering the page *tree* (does any descendant match?) is out of
// scope for this ticket, so an active filter temporarily replaces the tree view instead
// of pruning it.
function FilteredPagesList({
	loading,
	results,
	onSelect,
}: {
	loading: boolean;
	results: WikiListItem[];
	onSelect: (slug: string) => void;
}) {
	if (loading) return <p className="text-[0.8rem] text-text-muted m-0">Loading…</p>;
	if (results.length === 0)
		return <p className="text-[0.8rem] text-text-muted m-0">No matching pages</p>;
	return (
		<ul className="list-none m-0 p-0">
			{results.map((r) => (
				<li key={r.id}>
					<button
						type="button"
						className={SEARCH_RESULT_BUTTON_CLASS}
						onClick={() => onSelect(r.slug)}
					>
						<span className="font-medium">{r.title}</span>
						{(r.type || r.status || (r.tags?.length ?? 0) > 0) && (
							<span className="block mt-[0.15rem]">
								{r.status && <WikiStatusPill status={r.status} />}
								<TagChips tags={r.tags} />
							</span>
						)}
					</button>
				</li>
			))}
		</ul>
	);
}

function PageTreeList({
	loading,
	tree,
	slug,
	onNavigate,
}: {
	loading: boolean;
	tree: TreeNode[];
	slug: string;
	onNavigate: (slug: string) => void;
}) {
	if (loading) return <p className="text-[0.8rem] text-text-muted m-0">Loading…</p>;
	return (
		<ul className="list-none m-0 p-0">
			{tree.map((node) => (
				<TreeNodeItem
					key={node.id}
					node={node}
					currentSlug={slug}
					depth={0}
					onNavigate={onNavigate}
				/>
			))}
			{tree.length === 0 && <li className="text-[0.8rem] text-text-muted">No pages yet</li>}
		</ul>
	);
}

// Lets a user viewing the workspace-wide wiki (or one project's wiki) switch to another
// scope explicitly, since the only other entry point is a project's nav tab. Switching
// scope is a full navigation (fresh tree/search for the new scope), not an in-place swap.
function useProjects(_workspaceSlug: string | undefined) {
	return useWikiSeed().projects;
}
function useWikiTemplates(_workspaceSlug: string | undefined) {
	return useWikiSeed().templates;
}

function ScopeControl({
	workspaceSlug,
	projectId,
}: {
	workspaceSlug: string | undefined;
	projectId: string;
}) {
	const seed = useWikiSeed();
	const projects = useProjects(workspaceSlug);
	const options: SelectOption[] = [
		{ value: "", label: "Workspace (all projects)" },
		...projects.map((p) => ({ value: p.id, label: `${p.key} — ${p.name}` })),
	];

	return (
		<div className="mb-3">
			<p className="m-0 mb-1 text-[0.7rem] text-text-muted">Scope</p>
			<Select
				value={projectId}
				options={options}
				ariaLabel="Wiki project scope"
				onChange={(value) => {
					navigateFeature(wikiHref({ ...seed, projectId: value }, "/wiki"));
				}}
			/>
		</div>
	);
}

// PROJ-488: type/status dropdowns + a comma-separated tags text filter, shared between
// the sidebar's filtered browse view and (via useWikiSearch) text search.
function WikiFilterBar({
	filterType,
	onFilterTypeChange,
	typeOptions,
	filterStatus,
	onFilterStatusChange,
	filterTags,
	onFilterTagsChange,
}: {
	filterType: string;
	onFilterTypeChange: (v: string) => void;
	typeOptions: SelectOption[];
	filterStatus: string;
	onFilterStatusChange: (v: string) => void;
	filterTags: string;
	onFilterTagsChange: (v: string) => void;
}) {
	return (
		<div className="mb-3 flex flex-col gap-1.5">
			<input type="hidden" name="type" value={filterType} />
			<input type="hidden" name="status" value={filterStatus} />
			<Select
				value={filterType}
				options={typeOptions}
				ariaLabel="Filter wiki pages by type"
				onChange={onFilterTypeChange}
			/>
			<Select
				value={filterStatus}
				options={WIKI_STATUS_FILTER_OPTIONS}
				ariaLabel="Filter wiki pages by status"
				onChange={onFilterStatusChange}
			/>
			<input
				type="text"
				name="tags"
				maxLength={2549}
				value={filterTags}
				onChange={(e) => onFilterTagsChange((e.target as HTMLInputElement).value)}
				placeholder="Filter by tags (comma-separated)…"
				className="w-full px-3 py-[0.375rem] border border-border rounded text-sm bg-bg text-text-base box-border"
				aria-label="Filter wiki pages by tags"
			/>
		</div>
	);
}

function WikiSidebar({
	workspaceSlug,
	projectId,
	searchQuery,
	onSearchQueryChange,
	searchResults,
	searchLoading,
	treeLoading,
	pageTree,
	slug,
	onNavigate,
	onCreate,
	filterType,
	onFilterTypeChange,
	typeOptions,
	filterStatus,
	onFilterStatusChange,
	filterTags,
	onFilterTagsChange,
	hasActiveFilters,
	filteredResults,
	filteredLoading,
	staleOpen,
	onToggleStale,
	stalePages,
	staleLoading,
	drawerOpen,
	isMobile,
	sidebarRef,
}: {
	workspaceSlug: string | undefined;
	projectId: string;
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	searchResults: SearchResult[];
	searchLoading: boolean;
	treeLoading: boolean;
	pageTree: TreeNode[];
	slug: string;
	onNavigate: (slug: string) => void;
	onCreate: () => void;
	filterType: string;
	onFilterTypeChange: (v: string) => void;
	typeOptions: SelectOption[];
	filterStatus: string;
	onFilterStatusChange: (v: string) => void;
	filterTags: string;
	onFilterTagsChange: (v: string) => void;
	hasActiveFilters: boolean;
	filteredResults: WikiListItem[];
	filteredLoading: boolean;
	staleOpen: boolean;
	onToggleStale: (open: boolean) => void;
	stalePages: StalePageItem[];
	staleLoading: boolean;
	// PROJ-664: below 640px this aside becomes an off-canvas drawer (see
	// WikiPageShell) instead of stacking full-width in flow above the article.
	drawerOpen: boolean;
	// PROJ-806: whether the drawer is acting as a drawer at all (mobile viewport) — on
	// desktop the sidebar is always in normal flow and must never be inert, even though
	// `drawerOpen` itself stays false there (it's only ever opened via the mobile trigger).
	isMobile: boolean;
	sidebarRef: RefObject<HTMLElement | null>;
}) {
	const asideClass = [
		"w-[240px] shrink-0 bg-surface border-r border-border p-4 overflow-y-auto",
		"wiki-sidebar",
		drawerOpen ? "wiki-sidebar-open" : "",
	].join(" ");
	const seed = useWikiSeed();
	const isPublicViewer = usePublicViewer(workspaceSlug);
	return (
		<aside
			id="wiki-page-tree"
			className={asideClass}
			aria-label="Wiki pages"
			ref={sidebarRef}
			inert={isMobile && !drawerOpen}
		>
			<ScopeControl workspaceSlug={workspaceSlug} projectId={projectId} />
			{!isPublicViewer && (
				<Button variant="primary" onClick={onCreate} className="w-full mb-4 max-sm:min-h-[44px]">
					+ New page
				</Button>
			)}
			<form method="get" action={seed.slug ? `/wiki/${encodeURIComponent(seed.slug)}` : "/wiki"}>
				<input type="hidden" name="workspace" value={seed.workspaceSlug} />
				{seed.projectId ? (
					<input type="hidden" name="projectId" value={seed.projectId} />
				) : (
					<input type="hidden" name="scope" value="workspace" />
				)}
				<input
					type="search"
					name="q"
					maxLength={2000}
					value={searchQuery}
					onChange={(e) => onSearchQueryChange((e.target as HTMLInputElement).value)}
					placeholder="Search pages…"
					className="w-full px-3 py-[0.375rem] mb-3 border border-border rounded text-sm bg-bg text-text-base box-border"
					aria-label="Search wiki pages"
				/>
				<WikiFilterBar
					filterType={filterType}
					onFilterTypeChange={onFilterTypeChange}
					typeOptions={typeOptions}
					filterStatus={filterStatus}
					onFilterStatusChange={onFilterStatusChange}
					filterTags={filterTags}
					onFilterTagsChange={onFilterTagsChange}
				/>
				<Button type="submit" variant="outline" size="sm" className="w-full mb-3">
					Search / apply filters
				</Button>
			</form>
			{seed.searchQuery.trim() ? (
				<SearchResultsList
					loading={searchLoading}
					results={searchResults}
					onSelect={(s) => {
						onSearchQueryChange("");
						onNavigate(s);
					}}
				/>
			) : hasActiveFilters ? (
				<FilteredPagesList
					loading={filteredLoading}
					results={filteredResults}
					onSelect={onNavigate}
				/>
			) : (
				<PageTreeList loading={treeLoading} tree={pageTree} slug={slug} onNavigate={onNavigate} />
			)}
			<details
				className="mt-3 pt-3 border-t border-border"
				open={staleOpen}
				onToggle={(e) => onToggleStale(e.currentTarget.open)}
			>
				<summary className="cursor-pointer text-[0.8rem] text-text-muted select-none">
					Needs verification
				</summary>
				<div className="pt-2">
					<StalePagesList loading={staleLoading} results={stalePages} onSelect={onNavigate} />
				</div>
			</details>
		</aside>
	);
}

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
	parentTitle: string | null;
	title: string;
	slug: string;
	content: string;
	error: string | null;
	saving: boolean;
	templates: TemplateOption[];
	templateSlug: string;
	onTitleChange: (value: string) => void;
	onSlugChange: (value: string) => void;
	onContentChange: (value: string) => void;
	onTemplateChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const templateOptions: SelectOption[] = [
		{ value: "", label: "No template (blank page)" },
		...templates.map((t) => ({ value: t.slug, label: t.title })),
	];
	const selectedTemplate = templates.find((t) => t.slug === templateSlug) ?? null;

	return (
		<div>
			<h2 className="mb-6 text-2xl font-bold text-text-base">
				{parentTitle ? `New child page under "${parentTitle}"` : "New page"}
			</h2>
			{error && (
				<p role="alert" className="text-danger-text mb-3">
					{error}
				</p>
			)}
			<div className="mb-4">
				<label htmlFor="create-title" className="block font-medium text-sm text-text-base mb-1">
					Title <span className="text-danger-text">*</span>
				</label>
				<input
					id="create-title"
					type="text"
					value={title}
					onChange={(e) => onTitleChange((e.target as HTMLInputElement).value)}
					placeholder="Page title"
					className="w-full px-3 py-2 border border-border rounded text-sm bg-bg text-text-base box-border text-base"
				/>
			</div>
			<div className="mb-4">
				<label htmlFor="create-slug" className="block font-medium text-sm text-text-base mb-1">
					Slug
				</label>
				<input
					id="create-slug"
					type="text"
					value={slug}
					onChange={(e) => onSlugChange((e.target as HTMLInputElement).value)}
					placeholder="auto-derived-from-title"
					className="w-full px-3 py-2 border border-border rounded text-sm bg-bg text-text-base box-border font-mono"
				/>
			</div>
			{templates.length > 0 && (
				<div className="mb-4">
					<p className="m-0 mb-1 font-medium text-sm text-text-base">Template</p>
					<Select
						value={templateSlug}
						options={templateOptions}
						ariaLabel="Seed content from template"
						onChange={onTemplateChange}
					/>
				</div>
			)}
			<div className="mb-5">
				{selectedTemplate ? (
					<p className="text-sm text-text-muted">
						Content will be seeded from the "{selectedTemplate.title}" template on create.
					</p>
				) : (
					<>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: caption for MarkdownEditor, which has no associable control */}
						<label className="block font-medium text-sm text-text-base mb-1">
							Content (Markdown)
						</label>
						<MarkdownEditor value={content} onChange={onContentChange} minHeight="280px" />
					</>
				)}
			</div>
			<div className="flex gap-2">
				<Button variant="primary" onClick={onSubmit} disabled={saving}>
					{saving ? "Creating…" : "Create page"}
				</Button>
				<Button variant="outline" onClick={onCancel} disabled={saving}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

const BREADCRUMB_BUTTON_CLASS = [
	"bg-transparent border-none cursor-pointer text-text-muted text-[0.8rem] p-0",
	"underline decoration-transparent hover:text-accent hover:decoration-accent",
].join(" ");

function PageBreadcrumbs({
	breadcrumbs,
	onNavigate,
}: {
	breadcrumbs: FlatEntry[];
	onNavigate: (slug: string) => void;
}) {
	if (breadcrumbs.length <= 1) return null;
	return (
		<nav
			className="wiki-breadcrumb text-[0.8rem] text-text-muted mb-3 flex flex-wrap gap-1 items-center"
			aria-label="Breadcrumb"
		>
			<button
				type="button"
				className={BREADCRUMB_BUTTON_CLASS}
				onClick={() => onNavigate(breadcrumbs[0].slug)}
			>
				Home
			</button>
			{breadcrumbs.slice(1, -1).map((crumb) => (
				// PROJ-806: the key belongs on the list item itself (this fragment), not a
				// DOM node nested inside it — Preact reconciles the fragment's children by
				// their position, not the key on a descendant, so a key here (rather than on
				// the button) is what actually makes each breadcrumb crumb identifiable
				// across re-renders when the list changes.
				<Fragment key={crumb.id}>
					<span>›</span>
					<button
						type="button"
						className={BREADCRUMB_BUTTON_CLASS}
						onClick={() => onNavigate(crumb.slug)}
					>
						{crumb.title}
					</button>
				</Fragment>
			))}
			<span>›</span>
			<span className="text-text-base">{breadcrumbs[breadcrumbs.length - 1].title}</span>
		</nav>
	);
}

function MovePageForm({
	options,
	value,
	saving,
	error,
	onChange,
	onSubmit,
	onCancel,
}: {
	options: SelectOption[];
	value: string;
	saving: boolean;
	error: string | null;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="mb-4 p-3 border border-border rounded bg-surface">
			<p className="m-0 mb-2 text-sm font-medium text-text-base">Move to a new parent page</p>
			{error && (
				<p role="alert" className="text-danger-text mb-2 text-sm">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-2 items-center">
				<div className="min-w-[220px]">
					<Select value={value} options={options} ariaLabel="New parent page" onChange={onChange} />
				</div>
				<Button variant="primary" size="sm" onClick={onSubmit} disabled={saving}>
					{saving ? "Moving…" : "Move"}
				</Button>
				<Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

const TOC_LINK_BASE_CLASS =
	"block py-[0.2rem] no-underline border-l-2 transition-[color,border-color] duration-150";
const TOC_LINK_ACTIVE_CLASS = "text-accent border-accent font-medium";
const TOC_LINK_INACTIVE_CLASS =
	"text-text-muted border-border hover:text-accent hover:border-accent";

function TocList({
	toc,
	activeHeadingId,
	onClick,
}: {
	toc: TocItem[];
	activeHeadingId: string;
	onClick?: () => void;
}) {
	return (
		<>
			{toc.map((item) => {
				const isTocActive = activeHeadingId === item.id;
				return (
					<a
						key={item.id}
						href={`#${item.id}`}
						className={`${TOC_LINK_BASE_CLASS} ${isTocActive ? TOC_LINK_ACTIVE_CLASS : TOC_LINK_INACTIVE_CLASS}`}
						style={{ paddingLeft: `${(item.level - 1) * 0.75 + 0.5}rem` }}
						onClick={onClick}
					>
						{item.text}
					</a>
				);
			})}
		</>
	);
}

// PROJ-664: on mobile the [+ Child page]/[Move]/[Delete] buttons that used to
// sit inline (326px, shrink-0, no scrolling ancestor) pushed scrollWidth past
// the viewport and crushed the title. Below 640px only Edit stays inline;
// the rest move behind this menu. Mirrors AccountMenu's trigger+Popover shape.
function useDuplicateWikiPage() {
	const seed = useWikiSeed();
	const [duplicating, setDuplicating] = useState(false);
	async function duplicate() {
		if (!seed.page || duplicating) return;
		setDuplicating(true);
		try {
			const copy = unwrapResult(
				await duplicateWikiPage({ workspaceSlug: seed.workspaceSlug, slug: seed.page.slug })
			);
			navigateFeature(wikiHref(seed, `/wiki/${encodeURIComponent(copy.slug)}`));
		} catch (error) {
			window.alert(`Could not duplicate page: ${String(error)}`);
		} finally {
			setDuplicating(false);
		}
	}
	return { duplicate, duplicating };
}

function PageActionOverflowMenu({
	pageId,
	onStartCreateChild,
	onStartMove,
	onDelete,
}: {
	pageId: string;
	onStartCreateChild: (pageId: string) => void;
	onStartMove: () => void;
	onDelete: () => void;
}) {
	const { duplicate, duplicating } = useDuplicateWikiPage();
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	const isInside = useCallback((node: Node) => {
		return !!(rootRef.current?.contains(node) || popoverRef.current?.contains(node));
	}, []);

	function openMenu() {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (rect) {
			setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
		}
		setOpen(true);
	}

	const menuItems = useCallback((): HTMLElement[] => {
		return Array.from(popoverRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
	}, []);

	const closeToTrigger = useCallback(() => {
		setOpen(false);
		triggerRef.current?.focus();
	}, []);

	// PROJ-806: a menu that opens without moving focus into itself, or that doesn't
	// support arrow keys, forces a screen reader or keyboard user to tab through the
	// rest of the page to reach it. Focus moves to the first item on open; ArrowUp/
	// ArrowDown cycle between items (wrapping), matching the standard menu pattern. The
	// items are tabindex=-1 (arrows move between them, not Tab), and Tab or Escape close
	// the menu back to its trigger — the menu is portalled to <body>, so letting Tab run
	// on would jump to wherever the portal sits in the document, not the next control
	// after ⋯.
	useEffect(() => {
		if (!open) return;
		menuItems()[0]?.focus();
		function onPointerDown(e: MouseEvent) {
			if (!(e.target instanceof Node) || !isInside(e.target)) setOpen(false);
		}
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" || e.key === "Tab") {
				e.preventDefault();
				closeToTrigger();
				return;
			}
			if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
			const items = menuItems();
			if (items.length === 0) return;
			e.preventDefault();
			const currentIndex = items.indexOf(document.activeElement as HTMLElement);
			const delta = e.key === "ArrowDown" ? 1 : -1;
			const nextIndex = (currentIndex + delta + items.length) % items.length;
			items[nextIndex]?.focus();
		}
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open, menuItems, isInside, closeToTrigger]);

	// Refocus the trigger *before* running the action: the menu (and the focused item)
	// is about to unmount, which would otherwise drop focus to <body>. An action that
	// moves focus somewhere deliberately still gets the last word.
	function runAndClose(fn: () => void) {
		closeToTrigger();
		fn();
	}

	return (
		<div className="relative" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="btn btn-outline btn-sm"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label="More page actions"
				onClick={() => (open ? setOpen(false) : openMenu())}
			>
				⋯
			</button>
			{open && pos && (
				<Popover
					id={menuId}
					role="menu"
					ariaLabel="More page actions"
					strategy="portal-fixed"
					elementRef={popoverRef}
					position={pos}
				>
					<button
						type="button"
						role="menuitem"
						tabIndex={-1}
						className="page-action-menu-item"
						onClick={() => runAndClose(() => onStartCreateChild(pageId))}
					>
						+ Child page
					</button>
					<button
						type="button"
						role="menuitem"
						tabIndex={-1}
						className="page-action-menu-item"
						onClick={() => runAndClose(onStartMove)}
					>
						Move
					</button>
					<button
						type="button"
						role="menuitem"
						tabIndex={-1}
						className="page-action-menu-item"
						disabled={duplicating}
						onClick={() => runAndClose(() => void duplicate())}
					>
						Duplicate
					</button>
					<button
						type="button"
						role="menuitem"
						tabIndex={-1}
						className="page-action-menu-item page-action-menu-item-danger"
						onClick={() => runAndClose(onDelete)}
					>
						Delete
					</button>
				</Popover>
			)}
		</div>
	);
}

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
	editing: boolean;
	pageId: string;
	title: string;
	editTitle: string;
	onEditTitleChange: (value: string) => void;
	saving: boolean;
	onSave: () => void;
	onCancelEdit: () => void;
	onStartEdit: () => void;
	onStartCreateChild: (pageId: string) => void;
	onStartMove: () => void;
	onDelete: () => void;
	isPublicViewer: boolean;
}) {
	const isMobile = useIsMobileViewport();
	const { duplicate, duplicating } = useDuplicateWikiPage();
	return (
		<header className="wiki-page-header flex items-start justify-between gap-4 mb-1">
			{editing ? (
				<input
					id="wiki-title"
					type="text"
					value={editTitle}
					onChange={(e) => onEditTitleChange((e.target as HTMLInputElement).value)}
					aria-label="Page title"
					className="flex-1 px-3 py-2 border border-border rounded text-sm bg-bg text-text-base box-border text-2xl font-bold"
				/>
			) : (
				<h1 className="m-0 text-[1.75rem] font-bold text-text-base">{title}</h1>
			)}

			{!isPublicViewer && (
				<div className="flex gap-2 shrink-0 max-sm:shrink">
					{editing ? (
						<>
							<Button variant="primary" onClick={onSave} disabled={saving}>
								{saving ? "Saving…" : "Save"}
							</Button>
							<Button variant="outline" onClick={onCancelEdit} disabled={saving}>
								Cancel
							</Button>
						</>
					) : isMobile ? (
						<>
							<Button variant="outline" onClick={onStartEdit}>
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
							<Button variant="outline" size="sm" onClick={() => onStartCreateChild(pageId)}>
								+ Child page
							</Button>
							<Button variant="outline" size="sm" onClick={onStartMove}>
								Move
							</Button>
							<Button variant="outline" onClick={onStartEdit}>
								Edit
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={duplicating}
								onClick={() => void duplicate()}
							>
								Duplicate
							</Button>
							<Button variant="danger" onClick={onDelete}>
								Delete
							</Button>
						</>
					)}
				</div>
			)}
		</header>
	);
}

// PROJ-495 (R13): the draft lives server-side now, so this can surface on any device —
// not just after a crash on the same browser.
function DraftRestoreBanner({
	updatedAt,
	pageChangedSince,
	onRestore,
	onDiscard,
}: {
	updatedAt: number;
	pageChangedSince?: boolean;
	onRestore: () => void;
	onDiscard: () => void;
}) {
	const bannerClass = [
		"mb-3 px-3 py-2 border border-border rounded bg-surface text-sm flex items-center",
		"justify-between gap-3 flex-wrap",
	].join(" ");
	return (
		<div className={bannerClass}>
			<span>
				Restore unsaved draft from {formatTimestamp(updatedAt)}?
				{pageChangedSince && (
					<span className="block text-text-muted text-[0.8rem]">
						The page has been saved since this draft was started — saving it will ask before
						overwriting.
					</span>
				)}
			</span>
			<div className="flex gap-2 shrink-0">
				<Button variant="primary" size="sm" onClick={onRestore}>
					Restore
				</Button>
				<Button variant="outline" size="sm" onClick={onDiscard}>
					Discard
				</Button>
			</div>
		</div>
	);
}

// PROJ-492 (R10): renders the server's unified diff text (--- base / +++ current, @@
// hunks, +/- lines) with per-line coloring. An empty diff means the two sides are
// identical (services/wiki.ts#buildUnifiedDiff returns "" in that case).
function RevisionDiffView({ diff }: { diff: string }) {
	if (diff === "") {
		return <p className="mt-2 mb-1 text-[0.75rem] text-text-muted italic">No changes.</p>;
	}
	const occurrences = new Map<string, number>();
	return (
		<pre
			className={
				"mt-2 mb-1 p-2 bg-surface border border-border rounded-md text-[0.75rem] " +
				"overflow-x-auto leading-snug whitespace-pre-wrap"
			}
		>
			{diff.split("\n").map((line) => {
				const occurrence = occurrences.get(line) ?? 0;
				occurrences.set(line, occurrence + 1);
				const cls = line.startsWith("+")
					? "text-green-600"
					: line.startsWith("-")
						? "text-red-600"
						: "text-text-muted";
				return (
					<div key={`${line}:${occurrence}`} className={cls}>
						{line.length > 0 ? line : " "}
					</div>
				);
			})}
		</pre>
	);
}

// PROJ-808: restoring while the page is being edited raced the edit's own save against
// the restore's PUT — both build their request off the revision the user started from,
// so whichever lands second gets a 409 against a revision it created itself. Simplest
// correct fix: disable Restore during editing rather than trying to reconcile the two.
const RESTORE_DISABLED_WHILE_EDITING_REASON =
	"Finish or cancel editing before restoring a previous revision";

function RevisionRow({
	revision,
	workspaceSlug,
	pageSlug,
	onRestore,
	restoring,
	editing,
}: {
	revision: WikiRevision;
	workspaceSlug: string | undefined;
	pageSlug: string;
	onRestore: (revision: WikiRevision) => void;
	restoring: boolean;
	editing: boolean;
}) {
	const [diffOpen, setDiffOpen] = useState(false);
	const [diff, setDiff] = useState<string | null>(null);
	const [diffError, setDiffError] = useState<string | null>(null);
	const [diffLoading, setDiffLoading] = useState(false);

	async function toggleDiff() {
		if (diffOpen) {
			setDiffOpen(false);
			return;
		}
		setDiffOpen(true);
		if (diff !== null || diffLoading) return;
		setDiffLoading(true);
		setDiffError(null);
		try {
			const result = unwrapResult(
				await Effect.runPromise(
					query(getWikiRevisionDiff)({ workspaceSlug, slug: pageSlug, revisionId: revision.id })
				)
			);
			setDiff(result.diff);
		} catch (e) {
			setDiffError(String(e));
		} finally {
			setDiffLoading(false);
		}
	}

	return (
		<li className="py-[0.375rem] border-b border-border text-[0.8rem] text-text-muted">
			<div className="flex items-center flex-wrap gap-2">
				<span>
					<strong className="text-text-base">{revision.author_name ?? "Unknown"}</strong>
					{" — "}
					{formatTimestamp(revision.created_at)}
				</span>
				<Button
					variant="outline"
					size="sm"
					onClick={toggleDiff}
					className="text-text-muted py-0 px-2"
				>
					{diffOpen ? "Hide diff" : "Diff vs current"}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onRestore(revision)}
					disabled={restoring || editing}
					title={editing ? RESTORE_DISABLED_WHILE_EDITING_REASON : undefined}
					className="text-text-muted py-0 px-2"
				>
					{restoring ? "Restoring…" : "Restore"}
				</Button>
			</div>
			{revision.summary && <p className="mt-1 mb-0 italic">{revision.summary}</p>}
			{diffOpen &&
				(diffLoading ? (
					<p className="mt-2 mb-1 text-[0.75rem]">Loading diff…</p>
				) : diffError ? (
					<p role="alert" className="mt-2 mb-1 text-[0.75rem] text-danger-text">
						{diffError}
					</p>
				) : (
					<RevisionDiffView diff={diff ?? ""} />
				))}
		</li>
	);
}

function RevisionsHistory({
	revisions,
	showHistory,
	onToggle,
	workspaceSlug,
	pageSlug,
	onRestore,
	restoringId,
	editing,
}: {
	revisions: WikiRevision[];
	showHistory: boolean;
	onToggle: () => void;
	workspaceSlug: string | undefined;
	pageSlug: string;
	onRestore: (revision: WikiRevision) => void;
	restoringId: string | null;
	editing: boolean;
}) {
	if (revisions.length === 0) return null;
	return (
		<div className="mt-8">
			<Button variant="outline" size="sm" onClick={onToggle} className="text-text-muted">
				{showHistory ? "▲ Hide history" : "▼ History"} ({revisions.length})
			</Button>
			{showHistory && (
				<ul className="mt-3 list-none p-0">
					{revisions.map((r) => (
						<RevisionRow
							key={r.id}
							revision={r}
							workspaceSlug={workspaceSlug}
							pageSlug={pageSlug}
							onRestore={onRestore}
							restoring={restoringId === r.id}
							editing={editing}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

// PROJ-494: whether an attachment's id appears anywhere in the page's current markdown
// (e.g. as part of an inline `![alt](/api/files/:id...)` ref). A plain substring check —
// good enough to tell "referenced" from "orphaned" without parsing markdown image syntax,
// and it also catches an id pasted into a manual link or wiki_ref-style reference.
function isReferenced(attachmentId: string, content: string): boolean {
	return content.includes(attachmentId);
}

const REFERENCED_BADGE_CLASS =
	"inline-flex items-center px-2 py-[0.1rem] rounded-full text-[0.72rem] font-semibold " +
	"uppercase tracking-wide shrink-0";

function AttachmentEntry({
	attachment,
	workspaceSlug,
	referenced,
	onDelete,
	isPublicViewer,
}: {
	attachment: Attachment;
	workspaceSlug?: string;
	referenced: boolean;
	onDelete: (attachmentId: string) => void;
	isPublicViewer: boolean;
}) {
	const qs = workspaceSlug ? `?workspace=${workspaceSlug}` : "";
	return (
		<div className="flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-surface">
			<a
				href={`/api/files/${attachment.id}${qs}`}
				target="_blank"
				rel="noreferrer"
				className="text-accent text-sm no-underline hover:underline flex-1 min-w-0 truncate"
			>
				{attachment.filename}
			</a>
			<span
				className={REFERENCED_BADGE_CLASS}
				style={
					referenced
						? { background: "var(--status-done-bg)", color: "var(--status-done)" }
						: { background: "var(--priority-low-bg)", color: "var(--priority-low-text)" }
				}
			>
				{referenced ? "In page" : "Unreferenced"}
			</span>
			<span className="text-xs text-text-muted shrink-0">{formatBytes(attachment.size)}</span>
			{!isPublicViewer && (
				<Button
					size="sm"
					onClick={() => onDelete(attachment.id)}
					aria-label={`Delete ${attachment.filename}`}
					className="bg-transparent border-none text-text-muted px-[0.125rem] leading-none"
				>
					×
				</Button>
			)}
		</div>
	);
}

function AttachmentUploadForm({
	uploadError,
	onCancel,
}: {
	uploadError: string | null;
	onCancel: () => void;
}) {
	const seed = useWikiSeed();
	const form = useForm({
		defaultValues: { file: null as File | null },
		validators: {
			onMount: Schema.toStandardSchemaV1(AttachmentFields),
			onChange: Schema.toStandardSchemaV1(AttachmentFields),
		},
	});
	const uploadFile = useStore(form.store, (state) => state.values.file);
	const valid = useStore(form.store, (state) => state.isValid);
	const errors = useStore(form.store, (state) => state.fieldMeta.file?.errors ?? []);
	const validatedSubmit = useRef(false);
	async function submit(event: React.FormEvent<HTMLFormElement>) {
		if (validatedSubmit.current) {
			validatedSubmit.current = false;
			return;
		}
		event.preventDefault();
		const nativeForm = event.currentTarget;
		await form.validate("change");
		if (!form.state.isValid) return;
		validatedSubmit.current = true;
		nativeForm.requestSubmit();
	}
	if (!seed.page) return null;
	return (
		<AttachmentUpload
			workspaceSlug={seed.workspaceSlug}
			entityType="wiki_page"
			entityId={seed.page.id}
			onSubmit={submit}
		>
			<div className="flex flex-wrap gap-2 items-center">
				<label className="relative cursor-pointer">
					<input
						type="file"
						name="file"
						required
						className="sr-only"
						onChange={(event) => form.setFieldValue("file", event.currentTarget.files?.[0] ?? null)}
					/>
					<Button as="span" variant="outline" size="sm">
						{uploadFile ? uploadFile.name : "Choose file"}
					</Button>
				</label>
				<Button type="submit" variant="primary" disabled={!valid}>
					Upload
				</Button>
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				{uploadError && (
					<span role="alert" className="text-[0.8rem] text-danger-text self-center">
						{uploadError}
					</span>
				)}
				{uploadFile && <FormErrors errors={errors} />}
			</div>
		</AttachmentUpload>
	);
}

function AttachmentsPanel({
	attachments,
	workspaceSlug,
	content,
	uploadFormOpen,
	uploadError,
	onToggleUploadForm,
	onCancelUpload,
	onDeleteAttachment,
}: {
	attachments: Attachment[];
	workspaceSlug?: string;
	content: string;
	uploadFormOpen: boolean;
	uploadError: string | null;
	onToggleUploadForm: (open: boolean) => void;
	onCancelUpload: () => void;
	onDeleteAttachment: (attachmentId: string) => void;
}) {
	const isPublicViewer = usePublicViewer(workspaceSlug);
	return (
		<div className="mt-8">
			<h3 className="text-xs uppercase tracking-[0.05em] text-text-muted font-semibold mb-3 pb-2 border-b border-border">
				{`Attachments${attachments.length > 0 ? ` (${attachments.length})` : ""}`}
			</h3>

			{attachments.length > 0 && (
				<div className="mb-4 flex flex-col gap-2">
					{attachments.map((a) => (
						<AttachmentEntry
							key={a.id}
							attachment={a}
							workspaceSlug={workspaceSlug}
							referenced={isReferenced(a.id, content)}
							onDelete={onDeleteAttachment}
							isPublicViewer={isPublicViewer}
						/>
					))}
				</div>
			)}

			{!isPublicViewer &&
				(uploadFormOpen ? (
					<AttachmentUploadForm uploadError={uploadError} onCancel={onCancelUpload} />
				) : (
					<button
						type="button"
						onClick={() => onToggleUploadForm(true)}
						className="text-sm text-text-muted hover:text-text-base transition-colors flex items-center gap-1"
					>
						<span className="text-base leading-none">+</span>
						<span>Attach file</span>
					</button>
				))}
		</div>
	);
}

interface PageArticleProps {
	page: WikiPageData;
	breadcrumbs: FlatEntry[];
	onNavigate: (slug: string) => void;
	showToc: boolean;
	toc: TocItem[];
	activeHeadingId: string;
	// PROJ-803: a callback ref (not a plain RefObject) so remounting the content div
	// (Cancel edit / Verify / Move) is observable as a mount-token bump, not just a
	// silent `.current` update — see useWikiPageData's contentMountToken.
	setContentRef: (node: HTMLDivElement | null) => void;
	editing: boolean;
	editTitle: string;
	onEditTitleChange: (value: string) => void;
	saving: boolean;
	onSave: () => void;
	onCancelEdit: () => void;
	onStartEdit: () => void;
	onStartCreateChild: (pageId: string) => void;
	onDelete: () => void;
	// PROJ-489 (R7): the metadata header card's Verify button.
	onVerify: () => void;
	verifying: boolean;
	verifyError: string | null;
	moving: boolean;
	moveOptions: SelectOption[];
	moveTargetId: string;
	moveSaving: boolean;
	moveError: string | null;
	onStartMove: () => void;
	onMoveTargetChange: (value: string) => void;
	onSubmitMove: () => void;
	onCancelMove: () => void;
	latestRevision: WikiRevision | null;
	saveError: string | null;
	// PROJ-797: set only after a 409 — rebases the user's text onto the current revision.
	onOverwriteWithMine: (() => void) | null;
	draftBanner: ServerDraft | null;
	draftWarning: string | null;
	onRestoreDraft: () => void;
	onDiscardDraft: () => void;
	editContent: string;
	onEditContentChange: (value: string) => void;
	// PROJ-860: pre-rendered (marked + wikilinks + DOMPurify), memoised on [content,
	// wikiPages] one level up — PageArticle never calls renderMdWithWikilinks itself.
	renderedHtml: string;
	revisions: WikiRevision[];
	showHistory: boolean;
	onToggleHistory: () => void;
	onRestoreRevision: (revision: WikiRevision) => void;
	restoringRevisionId: string | null;
	attachments: Attachment[];
	workspaceSlug?: string;
	uploadFormOpen: boolean;
	uploadError: string | null;
	onToggleUploadForm: (open: boolean) => void;
	onCancelUpload: () => void;
	onDeleteAttachment: (attachmentId: string) => void;
	onUploadInlineImage: (file: File) => Promise<string | null>;
}

function PageArticleMeta(
	props: Pick<
		PageArticleProps,
		| "page"
		| "breadcrumbs"
		| "onNavigate"
		| "showToc"
		| "toc"
		| "activeHeadingId"
		| "editing"
		| "editTitle"
		| "onEditTitleChange"
		| "saving"
		| "onSave"
		| "onCancelEdit"
		| "onStartEdit"
		| "onStartCreateChild"
		| "onDelete"
		| "onVerify"
		| "verifying"
		| "verifyError"
		| "moving"
		| "moveOptions"
		| "moveTargetId"
		| "moveSaving"
		| "moveError"
		| "onStartMove"
		| "onMoveTargetChange"
		| "onSubmitMove"
		| "onCancelMove"
		| "latestRevision"
		| "saveError"
		| "onOverwriteWithMine"
		| "draftBanner"
		| "draftWarning"
		| "onRestoreDraft"
		| "onDiscardDraft"
		| "workspaceSlug"
	>
) {
	const isPublicViewer = usePublicViewer(props.workspaceSlug);
	return (
		<>
			<PageBreadcrumbs breadcrumbs={props.breadcrumbs} onNavigate={props.onNavigate} />

			{props.showToc && (
				<details className="mb-4 max-[900px]:block min-[901px]:hidden">
					<summary className="cursor-pointer text-[0.8rem] text-text-muted select-none">
						Contents ({props.toc.length})
					</summary>
					<div className="pt-2">
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
				<p className="text-[0.8rem] text-text-muted mt-1 mb-5">
					Last edited by{" "}
					<strong className="text-text-base">
						{props.latestRevision.author_name ?? "Unknown"}
					</strong>{" "}
					at {formatTimestamp(props.latestRevision.created_at)}
				</p>
			)}

			{props.saveError && (
				<div role="alert" className="text-danger-text mb-3">
					<p className="m-0">{props.saveError}</p>
					{props.onOverwriteWithMine && (
						<div className="mt-2 flex gap-2 flex-wrap items-center">
							<Button variant="primary" size="sm" onClick={props.onOverwriteWithMine}>
								Overwrite with mine
							</Button>
							<span className="text-text-muted text-[0.8rem]">
								or copy your text from the editor before reloading.
							</span>
						</div>
					)}
				</div>
			)}

			{props.editing && props.draftWarning && (
				<p
					role="status"
					className="bg-warning-bg border border-warning-border rounded px-3 py-2 text-[0.85rem] mb-3"
				>
					{props.draftWarning}
				</p>
			)}

			{props.editing && props.draftBanner && (
				<DraftRestoreBanner
					updatedAt={props.draftBanner.updatedAt}
					pageChangedSince={props.draftBanner.pageChangedSince}
					onRestore={props.onRestoreDraft}
					onDiscard={props.onDiscardDraft}
				/>
			)}
		</>
	);
}

function PageArticle(props: PageArticleProps) {
	const { page } = props;
	// PROJ-860: memoise the rendered-content vnode itself, keyed on the already-memoised
	// Keep the sanitized article element stable across unrelated sidebar and scroll updates.
	const articleContent = useMemo(
		() => (
			<div
				ref={props.setContentRef}
				className="prose prose-sm max-w-none"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: body is sanitized before safe heading IDs and scoped links are added.
				dangerouslySetInnerHTML={{ __html: props.renderedHtml }}
			/>
		),
		[props.renderedHtml, props.setContentRef]
	);
	return (
		<div className="flex gap-8 items-start">
			<article className="flex-1 min-w-0">
				<PageArticleMeta {...props} />

				{props.editing ? (
					<div className="mb-3">
						<MarkdownEditor
							value={props.editContent}
							onChange={props.onEditContentChange}
							minHeight="320px"
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

				<footer className="mt-8 pt-4 border-t border-border text-xs text-text-muted">
					Last updated: {formatTimestamp(page.updated_at)}
				</footer>
			</article>

			{props.showToc && (
				<nav
					className={[
						"w-[190px] shrink-0 sticky top-6 self-start max-h-[calc(100vh-3rem)]",
						"overflow-y-auto text-[0.8rem] max-[900px]:hidden",
					].join(" ")}
					aria-label="Table of contents"
				>
					<h3 className="m-0 mb-2 text-xs uppercase tracking-[0.05em] text-text-muted font-semibold">
						Contents
					</h3>
					<TocList toc={props.toc} activeHeadingId={props.activeHeadingId} />
				</nav>
			)}
		</div>
	);
}

interface CreateFormProps {
	parentTitle: string | null;
	title: string;
	slug: string;
	content: string;
	error: string | null;
	saving: boolean;
	templates: TemplateOption[];
	templateSlug: string;
	onTitleChange: (value: string) => void;
	onSlugChange: (value: string) => void;
	onContentChange: (value: string) => void;
	onTemplateChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
}

function WikiMainContent(
	props: Readonly<{
		creating: boolean;
		createProps: CreateFormProps;
		slug: string;
		loading: boolean;
		error: string | null;
		page: WikiPageData | null;
		articleProps: Omit<PageArticleProps, "page">;
	}>
) {
	if (props.creating) return <CreatePageForm {...props.createProps} />;
	if (!props.slug) {
		return <p className="text-text-muted">Select a page from the sidebar or create a new one.</p>;
	}
	if (props.loading) return <p aria-live="polite">Loading…</p>;
	if (props.error) {
		// PROJ-487: a slug that resolves to nothing (not even via a PROJ-483 redirect)
		// gets a dedicated 404 message rather than the generic failure text.
		if (props.error.includes("404")) {
			return (
				<p role="alert" className="text-text-muted">
					No wiki page found at "{props.slug}".
				</p>
			);
		}
		return (
			<p role="alert" className="text-danger-text">
				Failed to load page: {props.error}
			</p>
		);
	}
	if (!props.page) return null;
	return <PageArticle {...props.articleProps} page={props.page} />;
}

// The server route DTO owns identity. The local empty-slug transition only supports optimistic deletion before native navigation completes.
function useWikiUrlState(_slugProp: string | undefined) {
	const seed = useWikiSeed();
	const [slug, setSlug] = useState(seed.slug);
	useEffect(() => setSlug(seed.slug), [seed.slug]);
	return { slug, setSlug };
}
function useWikiScope(
	_workspaceSlug: string | undefined,
	_projectIdProp: string | undefined
): string {
	return useWikiSeed().projectId;
}

function useWikiTree(_workspaceSlug: string | undefined, _projectId: string | undefined) {
	const seed = useWikiSeed();
	const pageTree = seed.tree;
	const pageMap = useMemo(() => flattenTree(pageTree), [pageTree]);
	return { pageTree, pageMap, treeLoading: false };
}

// Preserve the original collapsible maintenance queue, seeded with request-owned stale-page DTOs.
function useWikiStalePages(_workspaceSlug: string | undefined, _projectId: string | undefined) {
	const seed = useWikiSeed();
	const [staleOpen, setStaleOpen] = useState(false);
	return { staleOpen, setStaleOpen, stalePages: seed.stalePages, staleLoading: false };
}

// PROJ-488: type/status/tags filters shared between the sidebar's filtered browse view
// (no search query — a flat list from listWikiPages) and text search below (combined
// with the FTS query via search_wiki's own type/status/tags params).
function useWikiFilters(
	_workspaceSlug: string | undefined,
	_projectId: string | undefined,
	pageTree: readonly TreeNode[]
) {
	const seed = useWikiSeed();
	const filterForm = useForm({
		defaultValues: { type: seed.filterType, status: seed.filterStatus, tags: seed.filterTags },
		validators: { onChange: Schema.toStandardSchemaV1(FilterFields) },
	});
	const {
		type: filterType,
		status: filterStatus,
		tags: filterTags,
	} = useStore(filterForm.store, (state) => state.values);
	useEffect(() => {
		filterForm.reset({ type: seed.filterType, status: seed.filterStatus, tags: seed.filterTags });
	}, [filterForm, seed.filterType, seed.filterStatus, seed.filterTags]);
	const typeOptions = useMemo(() => buildTypeFilterOptions(collectTreeTypes(pageTree)), [pageTree]);
	return {
		filterType,
		setFilterType: (value: string) => filterForm.setFieldValue("type", value),
		filterStatus,
		setFilterStatus: (value: string) => filterForm.setFieldValue("status", value),
		filterTags,
		setFilterTags: (value: string) => filterForm.setFieldValue("tags", value),
		filteredResults: seed.filteredPages,
		filteredLoading: false,
		hasActiveFilters: Boolean(seed.filterType || seed.filterStatus || seed.filterTags.trim()),
		typeOptions,
	};
}

function useWikiSearch(
	_workspaceSlug: string | undefined,
	_projectId: string | undefined,
	_filters: Readonly<{ filterType: string; filterStatus: string; filterTags: string }>
) {
	const seed = useWikiSeed();
	const searchForm = useForm({
		defaultValues: { query: seed.searchQuery },
		validators: { onChange: Schema.toStandardSchemaV1(SearchFields) },
	});
	const searchQuery = useStore(searchForm.store, (state) => state.values.query);
	useEffect(() => {
		searchForm.reset({ query: seed.searchQuery });
	}, [searchForm, seed.searchQuery]);
	return {
		searchQuery,
		setSearchQuery: (value: string) => searchForm.setFieldValue("query", value),
		searchResults: seed.searchResults,
		searchLoading: false,
	};
}

function useWikiPageData(_workspaceSlug: string | undefined, _slug: string) {
	const seed = useWikiSeed();
	const [deletedPageId, setDeletedPageId] = useState<string | null>(null);
	const page = seed.page?.id === deletedPageId ? null : seed.page;
	const setPage = (value: WikiPageData | null) =>
		setDeletedPageId(value ? null : (seed.page?.id ?? null));
	const loading = false;
	const error = seed.slug && !seed.page ? "404" : null;
	const revisions = seed.revisions;
	// PROJ-507: whether `revisions` reflects a completed fetch for this page. An empty
	// list means two very different things to the optimistic lock — "this page has never
	// been revised" (baseRevisionId: null) vs "we don't know yet" — and conflating them
	// makes a legitimate save look like a conflict.
	const revisionsLoaded = true;
	const [showHistory, setShowHistory] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	// PROJ-803: the content div only mounts when `!editing` (PageArticle), so Cancel
	// edit / Verify / Move — anything that flips `editing` or otherwise remounts that
	// div without page.content changing — used to leave the TOC pointing at detached
	// nodes and mermaid blocks unrendered, because the post-render effects keyed only
	// on content. A callback ref bumps this token on every mount so those effects can
	// key on "the DOM actually changed" instead, composing with PROJ-860's HTML memo
	// (effects now depend on [renderedHtml, contentMountToken] — either changing means
	// there's new DOM to process).
	//
	// Why a counter and not the node itself in state: Preact recycles the same <div>
	// across Edit → Cancel (it morphs the article div into MarkdownEditor's root and
	// back, resetting innerHTML on the way), so the ref is called again with the
	// *identical* node and a [node] dependency would never change — the original bug. It
	// can also deliver the old mount's `null` after the new node. A bump on every non-null
	// call survives both. The cost is one extra run of these effects on first mount (the
	// bump lands in the commit after the HTML does).
	const [contentMountToken, setContentMountToken] = useState(0);
	const setContentRef = useCallback((node: HTMLDivElement | null) => {
		contentRef.current = node;
		if (node) setContentMountToken((t) => t + 1);
	}, []);

	// Revisions belong to the page the `slug` prop points at, so they're reset when it
	// changes — not on every fetchPage(), which also runs as a same-page refresh (after
	// a save or a move) and would leave the list empty until something refetched it.
	// Same-URL ServerFn refresh updates canonical state without touching editor drafts.
	useEffect(() => {
		if (seed.page) setDeletedPageId(null);
	}, [seed.page]);

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
	};
}

function excerptOf(content: string, maxLength = 200): string {
	// PROJ-488: never let a page's frontmatter YAML become its og:description.
	const plain = stripFrontmatter(content)
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/[#*_>`[\]()!-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length > maxLength ? `${plain.slice(0, maxLength).trimEnd()}…` : plain;
}

// PROJ-487: the static build (see AGENTS.md) can't render per-page <title>/OG tags
// on the server — there's no per-request render step to do it in — so this updates
// them client-side once the page has loaded, the closest approximation available.

// PROJ-860: takes the already-memoised rendered HTML string, not `page`, so these
// post-render effects re-run exactly when the DOM they inspect actually changed —
// not on every WikiPage re-render.
// PROJ-860: marked + wikilink resolution + DOMPurify is the single most expensive
// thing WikiPage does (561 ms self time on a 187 KB page) — it used to run inline in
// JSX on *every* render, including unrelated ones (a sidebar search keystroke, a
// filter change, activeHeadingId ticking from the scroll observer). `wikiPages` must
// itself be a stable array identity (see the `useMemo` around `Object.values(pageMap)`
// in useWikiPageState) or this memo would recompute just as often as before.
//
// Keyed on the title map's *contents*, not the array's identity: every fetchTree()
// (after a save, a move, a create, or an empty tree landing after the page) builds a
// new array, and re-parsing an unchanged body for an unchanged title map is exactly the
// waste this exists to avoid. A real change to any title or slug still re-renders.
function useRenderedPageHtml(
	content: string | undefined,
	wikiPages: ReadonlyArray<{ title: string; slug: string }>
): string {
	const { workspaceSlug, projectId } = useWikiSeed();
	return useMemo(() => {
		if (content === undefined) return "";
		const html = decorateHeadings(renderMdWithWikilinks(stripFrontmatter(content), wikiPages)).html;
		return html.replace(
			/href="(\/wiki\/[^"]*|\?createTitle=[^"]*)"/g,
			(_match, path: string) =>
				'href="' +
				wikiHref({ workspaceSlug, projectId }, path.replace(/&amp;/g, "&"))
					.replace(/&/g, "&amp;")
					.replace(/"/g, "&quot;") +
				'"'
		);
	}, [content, wikiPages, workspaceSlug, projectId]);
}

function useTableOfContents(
	page: WikiPageData | null,
	contentRef: RefObject<HTMLDivElement | null>,
	renderedHtml: string,
	// PROJ-803: bumped by the content div's callback ref every time it mounts, so
	// Cancel/Verify/Move (which remount the div without page.content changing) still
	// re-run these effects against the new DOM node.
	contentMountToken: number
) {
	const [toc, setToc] = useState<TocItem[]>(() => decorateHeadings(renderedHtml).toc);
	const [activeHeadingId, setActiveHeadingId] = useState("");

	// Headings and IDs already exist in sanitized server HTML. Adopt refreshed contents.
	useEffect(() => {
		setToc(decorateHeadings(renderedHtml).toc);
	}, [renderedHtml]);

	// Hydrate ```mermaid code blocks into rendered diagrams
	useEffect(() => {
		const container = contentRef.current;
		if (!container || !page || !renderedHtml || contentMountToken < 1) return;
		renderMermaidDiagrams(container).catch(() => {
			// non-fatal — leave the raw code block visible
		});
	}, [contentRef.current, page, renderedHtml, contentMountToken]);

	// PROJ-113: IntersectionObserver for active heading
	useEffect(() => {
		if (toc.length < 3 || typeof IntersectionObserver === "undefined") return;
		const container = contentRef.current;
		if (!container) return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveHeadingId(entry.target.id);
						break;
					}
				}
			},
			{ rootMargin: "-10% 0% -70% 0%", threshold: 0 }
		);
		const headings = container.querySelectorAll("h1[id], h2[id], h3[id]");
		headings.forEach((h) => {
			observer.observe(h);
		});
		return () => observer.disconnect();
	}, [toc, contentRef.current]);

	return { toc, activeHeadingId };
}

// PROJ-802: heading ids are only assigned once the content has rendered (the effects
// above), so a link like /wiki/foo#setup used to always open at the top of the page —
// nothing ever re-checked location.hash once the target id actually existed. `toc`
// changing covers first load and framework navigation, which rebuild the
// page and its TOC); hashchange covers clicking a same-page #anchor (including a TOC
// link) without a full navigation. Native currententrychange covers Back/Forward.
//
// A TOC rebuild is *not* a navigation, though: Cancel edit, Verify, Move and a late tree
// load all rebuild it on the same page and hash. Re-scrolling on each of those yanked the
// reader back to the anchor and stole focus from whatever they were doing, so each
// page-slug + hash pair is handled once. Only hash or native entry changes (navigation,
// even back to the same hash) clear that and allow another scroll.
function findInContent(container: HTMLElement, id: string): HTMLElement | null {
	// Only the rendered page body counts — an id elsewhere (the sidebar's
	// `wiki-page-tree`, the TOC nav, …) must not hijack the anchor. Matched by property
	// rather than a `#id` selector so ids needing CSS escaping still work.
	for (const el of container.querySelectorAll<HTMLElement>("[id]")) {
		if (el.id === id) return el;
	}
	return null;
}

function useHashScroll(
	toc: readonly TocItem[],
	contentRef: RefObject<HTMLDivElement | null>,
	pageSlug: string | undefined
) {
	const handledRef = useRef<string | null>(null);
	const slugRef = useRef(pageSlug);
	slugRef.current = pageSlug;

	const scrollToHash = useCallback(() => {
		// PROJ-802: some call sites (and this file's own tests, see PROJ-487) swap
		// `window.location` for a partial stand-in that may not define `hash` at all.
		const raw = (window.location.hash ?? "").slice(1);
		if (!raw) return;
		const key = `${slugRef.current ?? ""}#${raw}`;
		if (handledRef.current === key) return;
		const container = contentRef.current;
		if (!container) return;
		const heading = findInContent(container, safeDecodeURIComponent(raw) ?? raw);
		// Not rendered yet (or not on this page) — leave it unhandled so the next TOC
		// build, once the target exists, can still scroll to it.
		if (!heading) return;
		handledRef.current = key;
		heading.scrollIntoView();
		// Headings aren't focusable by default — tabindex=-1 lets focus() target them
		// programmatically (screen reader users land there too) without adding them to
		// the normal Tab order.
		heading.setAttribute("tabindex", "-1");
		heading.focus({ preventScroll: true });
	}, [contentRef]);

	useEffect(() => {
		if (toc.length > 0) scrollToHash();
	}, [toc, scrollToHash]);

	useEffect(() => {
		function onNavigate() {
			handledRef.current = null;
			scrollToHash();
		}
		window.addEventListener("hashchange", onNavigate);
		window.navigation?.addEventListener("currententrychange", onNavigate);
		return () => {
			window.removeEventListener("hashchange", onNavigate);
			window.navigation?.removeEventListener("currententrychange", onNavigate);
		};
	}, [scrollToHash]);
}

function useWikiAttachments(workspaceSlug: string | undefined, page: WikiPageData | null) {
	const seed = useWikiSeed();
	const [uploadFormOpen, setUploadFormOpen] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [inlineAttachments, setInlineAttachments] = useState<Attachment[]>([]);
	const attachments = [
		...seed.attachments,
		...inlineAttachments.filter(
			(file) => !seed.attachments.some((current) => current.id === file.id)
		),
	];
	function cancelUpload() {
		setUploadFormOpen(false);
		setUploadError(null);
	}
	async function deleteAttachment(attachmentId: string) {
		if (!page) return;
		setUploadError(null);
		try {
			unwrapResult(await deleteWikiAttachment({ workspaceSlug, attachmentId }));
			setInlineAttachments((files) => files.filter((file) => file.id !== attachmentId));
		} catch (error) {
			setUploadFormOpen(true);
			setUploadError(`Couldn't delete attachment: ${String(error)}`);
		}
	}
	async function uploadInlineImage(file: File): Promise<string | null> {
		if (!page || !workspaceSlug) return null;
		try {
			// A named ServerFn preserves the draft/cursor while retaining Effront's request-body limit.
			const uploaded = unwrapResult(
				await uploadEditorImage({
					file,
					workspaceSlug,
					entityType: "wiki_page",
					entityId: page.id,
				})
			);
			setInlineAttachments((files) => [
				...files,
				{ ...uploaded, createdAt: Math.floor(Date.now() / 1000) },
			]);
			return `/api/files/${encodeURIComponent(uploaded.id)}?workspace=${encodeURIComponent(workspaceSlug)}`;
		} catch (error) {
			setUploadError(String(error));
			return null;
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
	};
}

// PROJ-495 (R13): server-side per-user draft autosave, replacing the PROJ-227
// localStorage version so an in-progress edit survives a device switch, not just a
// same-browser crash. Same ~1s debounce cadence as before; debouncing stays entirely
// client-side (no server-side throttling) so this is just a plain PUT on a timer.
//
// PROJ-799: a draft is only written when the edit actually differs from the
// published page (so opening and cancelling never leaves a spurious "Restore unsaved
// draft?" behind), and reverting to the published text deletes the draft this
// session wrote. Autosave is paused while a save is in flight, and stays off until
// the existing server draft has been checked — if that check fails, autosave is
// disabled for the session rather than risk overwriting a draft from another device.
export type DraftStatus = "loading" | "ready" | "failed";

interface UseServerDraftAutosaveOptions {
	workspaceSlug: string | undefined;
	editing: boolean;
	editTitle: string;
	editContent: string;
	page: WikiPageData | null;
	draftBanner: ServerDraft | null;
	baseRevisionId: string | null | undefined;
	saving: boolean;
	draftStatus: DraftStatus;
}

export function differsFromPublished(
	page: Readonly<{ title: string; content: string }>,
	title: string,
	content: string
): boolean {
	return title !== page.title || content !== page.content;
}

function mayWrite(
	s: UseServerDraftAutosaveOptions
): s is UseServerDraftAutosaveOptions & { page: WikiPageData } {
	return !!s.page && !s.draftBanner && !s.saving && s.draftStatus === "ready";
}

function useServerDraftAutosave(options: UseServerDraftAutosaveOptions) {
	const {
		workspaceSlug,
		editing,
		editTitle,
		editContent,
		page,
		draftBanner,
		baseRevisionId,
		saving,
		draftStatus,
	} = options;
	// Latest edit state for the flush-on-leave effect below, since its cleanup
	// closure would otherwise only see the values from when `editing` last changed.
	const latestDraftStateRef = useRef(options);
	latestDraftStateRef.current = options;

	// save() clears the draft itself right before leaving edit mode; set this to
	// suppress the flush below so it doesn't resurrect the just-cleared draft.
	const skipLeaveFlushRef = useRef(false);
	// PROJ-799: whether a server draft for this page is known to exist (this session
	// wrote one, or the user restored the one found on open). Only then does reverting
	// to the published text issue a DELETE — never for a draft this session hasn't seen.
	const seed = useWikiSeed();
	const serverHasDraftRef = useRef(seed.mode === "edit" && !!seed.draft);
	const lastPersistedRef = useRef<string | null>(null);

	const persistDraft = useCallback(
		(p: WikiPageData, title: string, content: string, base: string | null | undefined) => {
			// Best-effort: a failed autosave shouldn't interrupt editing or surface an
			// error — the explicit Save button remains the source of truth.
			if (differsFromPublished(p, title, content)) {
				const fingerprint = JSON.stringify([p.id, title, content, base ?? null]);
				if (lastPersistedRef.current === fingerprint) return;
				lastPersistedRef.current = fingerprint;
				serverHasDraftRef.current = true;
				void saveWikiDraft({
					workspaceSlug,
					slug: p.slug,
					title,
					content,
					baseRevisionId: base ?? null,
				})
					.then(unwrapResult)
					.catch(() => {
						lastPersistedRef.current = null;
					});
			} else if (serverHasDraftRef.current) {
				lastPersistedRef.current = null;
				serverHasDraftRef.current = false;
				void discardWikiDraft({ workspaceSlug, slug: p.slug })
					.then(unwrapResult)
					.catch(() => {});
			}
		},
		[workspaceSlug]
	);

	useEffect(() => {
		if (!editing || !page || draftBanner || saving || draftStatus !== "ready") return;
		const timer = setTimeout(() => {
			persistDraft(page, editTitle, editContent, baseRevisionId);
		}, 1000);
		return () => clearTimeout(timer);
	}, [
		editing,
		editTitle,
		editContent,
		page,
		draftBanner,
		baseRevisionId,
		saving,
		draftStatus,
		persistDraft,
	]);

	// Flush any not-yet-debounced edits when leaving edit mode via navigation (not
	// just Save/Cancel), so a quick click-away doesn't drop the last <1s of
	// keystrokes from the safety-net draft.
	useEffect(() => {
		const wasEditing = editing;
		return () => {
			if (!wasEditing) return;
			if (skipLeaveFlushRef.current) {
				skipLeaveFlushRef.current = false;
				return;
			}
			const s = latestDraftStateRef.current;
			if (!mayWrite(s)) return;
			persistDraft(s.page, s.editTitle, s.editContent, s.baseRevisionId);
		};
	}, [editing, persistDraft]);

	// PROJ-800: an explicit flush for callers about to clear page state in the same
	// batch as leaving edit mode (navigation). By the time the leave-flush cleanup
	// above runs, the ref already holds `page: null`, so it can't write — flush here
	// first, then suppress that now-redundant cleanup.
	function flushDraftNow() {
		const s = latestDraftStateRef.current;
		if (!s.editing) return;
		skipLeaveFlushRef.current = true;
		if (!mayWrite(s)) return;
		persistDraft(s.page, s.editTitle, s.editContent, s.baseRevisionId);
	}

	return { skipLeaveFlushRef, serverHasDraftRef, flushDraftNow };
}

// PROJ-800: closing or reloading the tab mid-edit asks first when there are unsaved
// changes — a debounced draft can't be flushed from an unloading page reliably.
function useUnsavedChangesGuard(
	editing: boolean,
	page: WikiPageData | null,
	editTitle: string,
	editContent: string
) {
	const dirty = editing && !!page && differsFromPublished(page, editTitle, editContent);
	useEffect(() => {
		if (!dirty) return;
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			// Legacy browsers only show the prompt when returnValue is set.
			e.returnValue = "";
		};
		const onNavigate = (event: NavigateEvent) => {
			const destination = new URL(event.destination.url);
			if (
				destination.origin === window.location.origin &&
				destination.pathname === window.location.pathname &&
				destination.search === window.location.search
			)
				return;
			if (
				event.cancelable &&
				!window.confirm(
					"Leave this page with unsaved changes? Save your changes first to avoid losing them."
				)
			)
				event.preventDefault();
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		window.navigation?.addEventListener("navigate", onNavigate);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
			window.navigation?.removeEventListener("navigate", onNavigate);
		};
	}, [dirty]);
}

async function saveWikiPageEdit(
	params: Readonly<{
		workspaceSlug: string | undefined;
		page: WikiPageData;
		editTitle: string;
		editContent: string;
		baseRevisionId: string | null | undefined;
	}>
): Promise<void> {
	const { workspaceSlug, page, editTitle, editContent, baseRevisionId } = params;
	unwrapResult(
		await saveWikiPage({
			workspaceSlug,
			slug: page.slug,
			title: editTitle,
			content: editContent,
			baseRevisionId,
		})
	);
}

// PROJ-507: a 409 means someone else saved this page after we loaded it (PROJ-484's
// optimistic lock rejected our stale baseRevisionId) — surface that distinctly rather
// than the generic failure message, so the user knows to reload instead of retrying the
// A typed ServerFn conflict is distinct from a protocol/network failure.
function isWikiSaveConflict(e: unknown): boolean {
	return e instanceof FunctionError ? e.status === 409 : String(e).endsWith("failed: 409");
}

function wikiSaveErrorMessage(e: unknown): string {
	if (isWikiSaveConflict(e)) {
		return (
			"This page was changed by someone else since you started editing. Overwrite it with " +
			"your version, or copy your text and reload to merge by hand."
		);
	}
	return `Save failed: ${String(e)}`;
}

function useWikiEditing(
	workspaceSlug: string | undefined,
	page: WikiPageData | null,
	latestRevisionId: string | null | undefined
) {
	const seed = useWikiSeed();
	const [editing, setEditing] = useState(seed.mode === "edit");
	const editForm = useForm({
		defaultValues: {
			title: seed.page?.title ?? "",
			content: seed.page?.content ?? "",
			baseRevisionId: seed.page?.revisionId ?? seed.revisions[0]?.id ?? null,
		} as typeof EditFields.Type,
		validators: { onChange: Schema.toStandardSchemaV1(EditFields) },
	});
	const {
		title: editTitle,
		content: editContent,
		baseRevisionId,
	} = useStore(editForm.store, (state) => state.values);
	const setEditTitle = (value: string) => editForm.setFieldValue("title", value);
	const setEditContent = (value: string) => editForm.setFieldValue("content", value);
	const setBaseRevisionId = (value: string | null | undefined) =>
		editForm.setFieldValue("baseRevisionId", value);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	// PROJ-797: the last save hit a 409 (someone else saved first).
	const [conflict, setConflict] = useState(false);
	const [draftBanner, setDraftBanner] = useState<ServerDraft | null>(
		seed.mode === "edit" &&
			seed.draft &&
			seed.page &&
			differsFromPublished(seed.page, seed.draft.title, seed.draft.content)
			? { ...seed.draft, pageChangedSince: seed.draft.baseRevisionId !== seed.page.revisionId }
			: null
	);
	// PROJ-507: the revision id of the content the user actually started editing,
	// frozen at startEdit() time — sent back as baseRevisionId so the server can
	// detect a concurrent edit landing between load and save (PROJ-484's optimistic
	// lock). Using the live `latestRevisionId` at save time instead would defeat the
	// check, since it tracks whatever the page's latest revision is *right now*.
	// `undefined` (revisions not loaded when editing started) omits the field, which
	// the server treats as the transitional last-write-wins path — sending `null` there
	// would instead assert "this page has no revisions" and fail every save.
	// PROJ-495: this same value is what the draft autosave stamps as its own
	// baseRevisionId, and restoring a draft snaps it back to the draft's own
	// baseRevisionId — so publishing a restored draft conflict-checks against what the
	// draft actually started from, not whatever the page's latest revision happens to
	// be now.

	const [draftStatus, setDraftStatus] = useState<DraftStatus>(seed.draftStatus);

	const { skipLeaveFlushRef, serverHasDraftRef, flushDraftNow } = useServerDraftAutosave({
		workspaceSlug,
		editing,
		editTitle,
		editContent,
		page,
		draftBanner,
		baseRevisionId,
		saving,
		draftStatus,
	});
	useUnsavedChangesGuard(editing, page, editTitle, editContent);

	// PROJ-495: draft is fetched from the server (not just a local check) so it
	// restores across devices, not only after a same-browser crash. Editing opens
	// immediately with the published content; the restore banner appears once the
	// fetch resolves, matching the R10 diff/choice pattern of offering rather than
	// silently applying.
	async function startEdit() {
		if (!page) return;
		setSaveError(null);
		setDraftBanner(null);
		setDraftStatus("loading");
		serverHasDraftRef.current = false;
		// PROJ-809: prefer the revision read together with this content; the separately
		// fetched revisions list can already include a save that the content predates.
		setBaseRevisionId(page.revisionId !== undefined ? page.revisionId : latestRevisionId);
		setEditTitle(page.title);
		setEditContent(page.content);
		setEditing(true);
		try {
			const draft = unwrapResult(
				await Effect.runPromise(query(getWikiDraft)({ workspaceSlug, slug: page.slug }))
			);
			// PROJ-797: offer any draft that differs from what's published, regardless
			// of timestamp order — a publish by someone else after the last autosave
			// used to hide the user's draft silently. The banner notes when the page
			// has changed since the draft was started.
			if (draft && (draft.content !== page.content || draft.title !== page.title)) {
				const pageChangedSince =
					page.revisionId !== undefined
						? draft.baseRevisionId !== page.revisionId
						: draft.updatedAt <= page.updated_at;
				setDraftBanner({ ...draft, pageChangedSince });
			}
			// A draft identical to the published page is still a row we may delete if
			// the user types and then reverts.
			serverHasDraftRef.current = !!draft;
			setDraftStatus("ready");
		} catch {
			// PROJ-799: we can't tell whether a draft from another device exists, so
			// autosaving now could silently overwrite it. Keep editing, but don't autosave.
			setDraftStatus("failed");
		}
	}

	function restoreDraft() {
		if (!draftBanner) return;
		setEditTitle(draftBanner.title);
		setEditContent(draftBanner.content);
		setBaseRevisionId(draftBanner.baseRevisionId);
		setDraftBanner(null);
		serverHasDraftRef.current = true;
	}

	async function discardDraft() {
		if (!page) return;
		setEditTitle(page.title);
		setEditContent(page.content);
		setDraftBanner(null);
		serverHasDraftRef.current = false;
		try {
			unwrapResult(await discardWikiDraft({ workspaceSlug, slug: page.slug }));
		} catch {
			// non-fatal
		}
	}

	function cancelEdit() {
		// PROJ-796: while the restore banner is unresolved, the server draft is the
		// user's unsaved work from elsewhere — leaving must not overwrite it with the
		// published text the editor was opened with.
		if (draftBanner) skipLeaveFlushRef.current = true;
		setEditing(false);
		setSaveError(null);
		setConflict(false);
		setDraftBanner(null);
	}

	// Wired straight to onClick, so it must not take the event as an argument.
	function save() {
		return saveWithBase(undefined);
	}

	async function saveWithBase(baseOverride: string | null | undefined) {
		if (!page) return;
		await editForm.validate("change");
		if (!editForm.state.isValid) {
			setSaveError(
				"Use a title between 1 and 300 characters and content at most 500000 characters."
			);
			return;
		}
		setSaving(true);
		setSaveError(null);
		setConflict(false);
		try {
			await saveWikiPageEdit({
				workspaceSlug,
				page,
				editTitle,
				editContent,
				baseRevisionId: baseOverride !== undefined ? baseOverride : baseRevisionId,
			});
			serverHasDraftRef.current = false;
			skipLeaveFlushRef.current = true;
			setEditing(false);
		} catch (e) {
			setSaveError(wikiSaveErrorMessage(e));
			setConflict(isWikiSaveConflict(e));
		} finally {
			setSaving(false);
		}
	}

	// PROJ-797: after a 409 the user is never stuck — this re-reads the page's current
	// revision and saves their text on top of it (a deliberate overwrite). Their text
	// stays in the editor either way, so they can also copy it out instead.
	async function overwriteWithMine() {
		if (!page) return;
		try {
			const current = unwrapResult(
				await Effect.runPromise(query(getWikiPage)({ workspaceSlug, slug: page.slug }))
			);
			const base = current.revisionId !== undefined ? current.revisionId : undefined;
			setBaseRevisionId(base);
			// null is a real base ("page has no revisions"); undefined means "server
			// predates revisionId", which falls back to last-write-wins.
			await saveWithBase(base === undefined ? null : base);
		} catch (e) {
			setSaveError(wikiSaveErrorMessage(e));
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
			editing && draftStatus === "failed"
				? "Couldn't check for an unsaved draft from another device, so autosave is off for this edit. Save when you're done."
				: null,
		flushDraftNow,
		startEdit,
		restoreDraft,
		discardDraft,
		cancelEdit,
		save,
	};
}

// PROJ-492 (R10): one-click restore is a client-side convenience — it reads the old
// revision's content, then resubmits it through the SAME update_wiki_page write path as
// a normal edit (baseRevisionId + summary), so it gets ordinary optimistic-locking/
// frontmatter/FTS/link-reindex treatment for free and creates a new revision rather than
// rewriting history. No dedicated restore endpoint.
function useWikiRestore(
	workspaceSlug: string | undefined,
	page: WikiPageData | null,
	latestRevisionId: string | null | undefined,
	editing: boolean
) {
	const [restoringId, setRestoringId] = useState<string | null>(null);

	async function restore(revision: WikiRevision) {
		if (!page) return;
		// PROJ-808: the Restore button is disabled while editing, but guard the action
		// itself too — restoring mid-edit races the edit's own save against this PUT,
		// and whichever lands second 409s against a revision it created itself.
		if (editing) return;
		const when = formatTimestamp(revision.created_at);
		if (
			!window.confirm(
				`Restore this page to the version from ${when}? This creates a new revision — no history is lost.`
			)
		) {
			return;
		}
		setRestoringId(revision.id);
		try {
			unwrapResult(
				await restoreWikiRevision({
					workspaceSlug,
					slug: page.slug,
					revisionId: revision.id,
					baseRevisionId: latestRevisionId ?? null,
				})
			);
		} catch (e) {
			if (isWikiSaveConflict(e)) {
				alert(
					"This page was changed by someone else since you loaded it. Reload the page before restoring."
				);
			} else {
				alert(`Restore failed: ${String(e)}`);
			}
		} finally {
			setRestoringId(null);
		}
	}

	return { restoringId, restore };
}

// PROJ-237: re-parent a page from the page menu. Backend validation (cycle guard,
// workspace scoping) already exists on PUT /api/wiki/:slug — this is UI-only.
function useMovePage(workspaceSlug: string | undefined, page: WikiPageData | null) {
	const [moving, setMoving] = useState(false);
	const moveForm = useForm({
		defaultValues: { parentId: "" },
		validators: { onChange: Schema.toStandardSchemaV1(MoveFields) },
	});
	const moveTargetId = useStore(moveForm.store, (state) => state.values.parentId);
	const setMoveTargetId = (value: string) => moveForm.setFieldValue("parentId", value);
	const [moveSaving, setMoveSaving] = useState(false);
	const [moveError, setMoveError] = useState<string | null>(null);

	function startMove() {
		if (!page) return;
		setMoveTargetId(page.parent_id ?? "");
		setMoveError(null);
		setMoving(true);
	}

	function cancelMove() {
		setMoving(false);
		setMoveError(null);
	}

	async function submitMove() {
		if (!page) return;
		setMoveSaving(true);
		setMoveError(null);
		try {
			unwrapResult(
				await moveWikiPage({ workspaceSlug, slug: page.slug, parentId: moveTargetId || null })
			);
			setMoving(false);
		} catch (e) {
			setMoveError(`Move failed: ${String(e)}`);
		} finally {
			setMoveSaving(false);
		}
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
	};
}

// PROJ-489 (R7): stamps verified_at/verified_by (server resolves the CALLING user's
// identity — nothing to pass here) and refetches the page so the header reflects the
// new freshness state immediately.
function useWikiVerify(workspaceSlug: string | undefined, page: WikiPageData | null) {
	const [verifying, setVerifying] = useState(false);
	const [verifyError, setVerifyError] = useState<string | null>(null);

	async function verifyPage() {
		if (!page) return;
		setVerifying(true);
		setVerifyError(null);
		try {
			unwrapResult(await verifyWikiPage({ workspaceSlug, slug: page.slug }));
		} catch (e) {
			setVerifyError(`Verify failed: ${String(e)}`);
		} finally {
			setVerifying(false);
		}
	}

	return { verifying, verifyError, verifyPage };
}

function useCreatePageForm(workspaceSlug: string | undefined, projectId: string) {
	const seed = useWikiSeed();
	const [creating, setCreating] = useState(seed.mode === "create" || !!seed.createTitle);
	const createForm = useForm({
		defaultValues: {
			title: seed.createTitle,
			slug: slugify(seed.createTitle),
			content: "",
			parentId: null as string | null,
			templateSlug: "",
		},
		validators: { onChange: Schema.toStandardSchemaV1(CreateFields) },
	});
	const {
		title: createTitle,
		slug: createSlug,
		content: createContent,
		parentId: createParentId,
		templateSlug: createTemplateSlug,
	} = useStore(createForm.store, (state) => state.values);
	const setCreateTitle = (value: string) => createForm.setFieldValue("title", value);
	const setCreateSlug = (value: string) => createForm.setFieldValue("slug", value);
	const setCreateContent = (value: string) => createForm.setFieldValue("content", value);
	const setCreateParentId = (value: string | null) => createForm.setFieldValue("parentId", value);
	const setCreateTemplateSlug = (value: string) => createForm.setFieldValue("templateSlug", value);
	const [createError, setCreateError] = useState<string | null>(null);
	const [createSaving, setCreateSaving] = useState(false);
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
	// PROJ-491 (R9): "" means no template selected — content is edited freely. Selecting a
	// template seeds content from create_wiki_page's templateSlug (server-side, mutually
	// exclusive with content) rather than duplicating the strip-template-flag logic here.

	function startCreate(parentId: string | null = null) {
		setCreating(true);
		setCreateTitle("");
		setCreateSlug("");
		setCreateContent("");
		setCreateParentId(parentId);
		setCreateError(null);
		setSlugManuallyEdited(false);
		setCreateTemplateSlug("");
	}

	function cancelCreate() {
		setCreating(false);
		setCreateError(null);
	}

	function onCreateTitleChange(v: string) {
		setCreateTitle(v);
		if (!slugManuallyEdited) setCreateSlug(slugify(v));
	}

	function onCreateSlugChange(v: string) {
		setCreateSlug(v);
		setSlugManuallyEdited(true);
	}

	function onCreateTemplateChange(v: string) {
		setCreateTemplateSlug(v);
		if (v) setCreateContent("");
	}

	async function submitCreate(): Promise<string | undefined> {
		await createForm.validate("change");
		if (!createForm.state.isValid) {
			setCreateError("Check the title, slug, and content limits.");
			return;
		}
		if (!createTitle.trim()) {
			setCreateError("Title is required.");
			return;
		}
		const finalSlug = createSlug.trim() || slugify(createTitle);
		if (!finalSlug) {
			setCreateError("Slug could not be derived from title.");
			return;
		}
		setCreateSaving(true);
		setCreateError(null);
		try {
			const created = unwrapResult(
				await createWikiPage({
					workspaceSlug,
					projectId: projectId || undefined,
					title: createTitle.trim(),
					slug: finalSlug,
					...(createTemplateSlug
						? { templateSlug: createTemplateSlug }
						: { content: createContent }),
					...(createParentId ? { parentId: createParentId } : {}),
				})
			);
			setCreating(false);
			return created.slug;
		} catch (e) {
			setCreateError(`Create failed: ${String(e)}`);
		} finally {
			setCreateSaving(false);
		}
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
	};
}

function createWikiActions(
	args: Readonly<{
		workspaceSlug: string | undefined;
		page: WikiPageData | null;
		setSlug: (s: string) => void;
		setEditing: (v: boolean) => void;
		flushDraftNow: () => void;
		setPage: (p: WikiPageData | null) => void;
		rawStartCreate: (parentId: string | null) => void;
		rawSubmitCreate: () => Promise<string | undefined>;
		cancelMove: () => void;
		// PROJ-807: shown after a successful delete, with an Undo action that calls the
		// existing trash-undelete endpoint. null dismisses whatever toast is showing.
		showUndoToast: (toast: UndoToast | null) => void;
		navigate: (path: string) => void;
	}>
) {
	const { workspaceSlug, page, setSlug, setEditing, setPage, showUndoToast } = args;

	function navigateTo(s: string) {
		args.flushDraftNow();
		args.navigate(s ? `/wiki/${encodeURIComponent(s)}` : "/wiki");
	}

	function startCreate(parentId: string | null = null) {
		setEditing(false);
		args.cancelMove();
		args.rawStartCreate(parentId);
	}

	async function submitCreate() {
		const createdSlug = await args.rawSubmitCreate();
		if (createdSlug) navigateTo(createdSlug);
	}

	async function deletePage() {
		if (!page) return;
		// PROJ-807: the backend soft-deletes into a 30-day trash (undeleteWikiPage) —
		// this used to claim the opposite.
		if (
			!window.confirm(
				`Delete "${page.title}"? The page (and any children) will move to trash for 30 days. You can undo this right after, or restore it from the trash later.`
			)
		) {
			return;
		}
		const deletedPage = page;
		try {
			// cascade=true trashes the children together with the page under one
			// trash_batch_id — which is what the dialog promises, and what lets Undo bring
			// the whole subtree back. Without it the API re-parents the children one level
			// up instead, and undelete could only restore the page on its own.
			unwrapResult(await trashWikiPage({ workspaceSlug, slug: page.slug }));
			setPage(null);
			setSlug("");

			showUndoToast({
				message: `"${deletedPage.title}" moved to trash.`,
				undo: async () => (await undeleteWikiPage(deletedPage.id, workspaceSlug)).slug,
				afterUndo: async (restoredSlug) => {
					navigateTo(restoredSlug || deletedPage.slug);
				},
			});
		} catch (e) {
			alert(`Delete failed: ${String(e)}`);
		}
	}

	return { navigateTo, startCreate, submitCreate, deletePage };
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
			z-index: 105;
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
			inset: 0;
			background: rgba(0, 0, 0, 0.45);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.22s ease;
			z-index: 104;
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
`;

// PROJ-664: owns the off-canvas page-tree drawer's open state, Esc-to-close,
// reset-on-resize-past-breakpoint, and a focus trap scoped to when the drawer
// is actually acting as a drawer (mobile) — on desktop the sidebar stays in
// normal flow, so trapping focus there would break ordinary tabbing.
function useWikiSidebarDrawer() {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);

	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!open) return;
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") close();
		}
		document.addEventListener("keydown", onKeyDown);
		const mq = window.matchMedia("(min-width: 641px)");
		const onGrow = (e: MediaQueryListEvent) => {
			if (e.matches) close();
		};
		mq.addEventListener("change", onGrow);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			mq.removeEventListener("change", onGrow);
		};
	}, [open, close]);

	// PROJ-806: this effect also fires on mount (effects always run after the first
	// render, `open` "changing" from nothing to its initial value), which used to move
	// focus to the "Pages" trigger button on every mobile page load even though the
	// user never opened or closed anything. Only actual open/close transitions —
	// something the person did — should move focus.
	const isFirstRenderRef = useRef(true);
	useEffect(() => {
		const isFirstRender = isFirstRenderRef.current;
		isFirstRenderRef.current = false;
		if (isFirstRender) return;
		if (!window.matchMedia(WIKI_MOBILE_QUERY).matches) return;
		if (open) {
			sidebarRef.current
				?.querySelector<HTMLElement>(
					'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
				)
				?.focus();
		} else {
			triggerRef.current?.focus();
		}
	}, [open]);

	useEffect(() => {
		if (!open) return;
		function onTrapTab(e: KeyboardEvent) {
			if (e.key !== "Tab") return;
			if (!window.matchMedia(WIKI_MOBILE_QUERY).matches) return;
			const container = sidebarRef.current;
			if (!container) return;
			const focusables = Array.from(
				container.querySelectorAll<HTMLElement>(
					'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
				)
			).filter((el) => !el.hasAttribute("disabled"));
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
		document.addEventListener("keydown", onTrapTab);
		return () => document.removeEventListener("keydown", onTrapTab);
	}, [open]);

	return { open, setOpen, close, triggerRef, sidebarRef };
}

function WikiPageShell(
	props: Readonly<{
		workspaceSlug: string | undefined;
		projectId: string;
		searchQuery: string;
		onSearchQueryChange: (v: string) => void;
		searchResults: SearchResult[];
		searchLoading: boolean;
		treeLoading: boolean;
		pageTree: TreeNode[];
		slug: string;
		onNavigate: (slug: string) => void;
		onCreate: () => void;
		filters: ReturnType<typeof useWikiFilters>;
		stale: ReturnType<typeof useWikiStalePages>;
		mainContentProps: {
			creating: boolean;
			createProps: CreateFormProps;
			slug: string;
			loading: boolean;
			error: string | null;
			page: WikiPageData | null;
			articleProps: Omit<PageArticleProps, "page">;
		};
	}>
) {
	const drawer = useWikiSidebarDrawer();
	const isMobile = useIsMobileViewport();
	// PROJ-664: picking a page or starting a create must close the drawer, or
	// tapping a page in the tree leaves the drawer covering the page just opened.
	const navigateAndClose = useCallback(
		(s: string) => {
			drawer.close();
			props.onNavigate(s);
		},
		[drawer.close, props.onNavigate]
	);
	const createAndClose = useCallback(() => {
		drawer.close();
		props.onCreate();
	}, [drawer.close, props.onCreate]);

	return (
		<div className="flex min-h-screen max-sm:flex-col">
			<style>{WIKI_PAGE_STYLES}</style>
			{isMobile && (
				<button
					type="button"
					ref={drawer.triggerRef}
					className="wiki-drawer-trigger"
					aria-expanded={drawer.open}
					aria-controls="wiki-page-tree"
					onClick={() => drawer.setOpen((o) => !o)}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<line x1="3" y1="6" x2="21" y2="6" />
						<line x1="3" y1="12" x2="21" y2="12" />
						<line x1="3" y1="18" x2="21" y2="18" />
					</svg>
					Pages
				</button>
			)}
			<div
				className={`wiki-drawer-overlay ${drawer.open ? "wiki-drawer-overlay-open" : ""}`}
				aria-hidden="true"
				onClick={drawer.close}
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
				drawerOpen={drawer.open}
				isMobile={isMobile}
				sidebarRef={drawer.sidebarRef}
			/>

			<main className="flex-1 p-8 max-sm:p-4 min-w-0">
				<WikiMainContent {...props.mainContentProps} />
			</main>
		</div>
	);
}

function deriveWikiPageState(
	pageData: ReturnType<typeof useWikiPageData>,
	pageMap: Record<string, FlatEntry>,
	// PROJ-860: passed in (memoised on [pageMap]) rather than recomputed here, so its
	// identity stays stable across renders this function runs on but pageMap doesn't change.
	wikiPages: readonly FlatEntry[],
	editState: ReturnType<typeof useWikiEditing>,
	createForm: ReturnType<typeof useCreatePageForm>,
	toc: readonly TocItem[]
) {
	const latestRevision = pageData.revisions[0] ?? null;
	// Breadcrumbs for current page (PROJ-114)
	const breadcrumbs = pageData.page ? getBreadcrumbs(pageData.page.id, pageMap) : [];
	// ToC sidebar (PROJ-113) — only when viewing page, ≥3 headings
	const showToc = !editState.editing && !createForm.creating && toc.length >= 3;
	const createParentTitle = createForm.createParentId
		? (pageMap[createForm.createParentId]?.title ?? null)
		: null;
	const moveOptions: SelectOption[] = [
		{ value: "", label: "No parent (root)" },
		...wikiPages
			.filter((p) => p.id !== pageData.page?.id)
			.map((p) => ({ value: p.id, label: p.title })),
	];
	return { latestRevision, breadcrumbs, showToc, createParentTitle, moveOptions };
}

function buildCreateFormProps(
	create: Readonly<{
		createParentTitle: string | null;
		createTitle: string;
		createSlug: string;
		createContent: string;
		createError: string | null;
		createSaving: boolean;
		templates: TemplateOption[];
		createTemplateSlug: string;
		onCreateTitleChange: (v: string) => void;
		onCreateSlugChange: (v: string) => void;
		setCreateContent: (v: string) => void;
		onCreateTemplateChange: (v: string) => void;
		submitCreate: () => void;
		cancelCreate: () => void;
	}>
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
	};
}

function buildArticleProps(
	article: Readonly<{
		breadcrumbs: FlatEntry[];
		navigateTo: (slug: string) => void;
		showToc: boolean;
		toc: TocItem[];
		activeHeadingId: string;
		setContentRef: (node: HTMLDivElement | null) => void;
		editing: boolean;
		editTitle: string;
		setEditTitle: (v: string) => void;
		saving: boolean;
		save: () => void;
		cancelEdit: () => void;
		startEdit: () => void;
		startCreate: (parentId: string | null) => void;
		deletePage: () => void;
		onVerify: () => void;
		verifying: boolean;
		verifyError: string | null;
		latestRevision: WikiRevision | null;
		saveError: string | null;
		overwriteWithMine: (() => void) | null;
		draftBanner: ServerDraft | null;
		draftWarning: string | null;
		restoreDraft: () => void;
		discardDraft: () => void;
		editContent: string;
		setEditContent: (v: string) => void;
		renderedHtml: string;
		revisions: WikiRevision[];
		showHistory: boolean;
		setShowHistory: (updater: (h: boolean) => boolean) => void;
		onRestoreRevision: (revision: WikiRevision) => void;
		restoringRevisionId: string | null;
		attach: ReturnType<typeof useWikiAttachments>;
		workspaceSlug: string | undefined;
		move: ReturnType<typeof useMovePage>;
		moveOptions: SelectOption[];
	}>
): Omit<PageArticleProps, "page"> {
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
		onToggleHistory: () => article.setShowHistory((h) => !h),
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
	};
}

function useWikiPageState(
	workspaceSlug: string | undefined,
	projectIdProp: string | undefined,
	slugProp: string | undefined
) {
	const { slug, setSlug } = useWikiUrlState(slugProp);
	const scope = useWikiScope(workspaceSlug, projectIdProp);
	const projectId = scope ?? "";
	// PROJ-807: the "moved to trash" Undo toast shown after a delete.
	const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
	const { pageTree, pageMap, treeLoading } = useWikiTree(workspaceSlug, scope);
	const filters = useWikiFilters(workspaceSlug, scope, pageTree);
	const stale = useWikiStalePages(workspaceSlug, scope);
	const { searchQuery, setSearchQuery, searchResults, searchLoading } = useWikiSearch(
		workspaceSlug,
		scope,
		{
			filterType: filters.filterType,
			filterStatus: filters.filterStatus,
			filterTags: filters.filterTags,
		}
	);

	// PROJ-860: stable array identity across renders that don't touch the tree, so this
	// can be a `useRenderedPageHtml`/`useMemo` dependency instead of invalidating on
	// every keystroke elsewhere in the page.
	const wikiPages = useMemo(() => Object.values(pageMap), [pageMap]);

	const pageData = useWikiPageData(workspaceSlug, slug);

	const renderedHtml = useRenderedPageHtml(pageData.page?.content, wikiPages);
	const { toc, activeHeadingId } = useTableOfContents(
		pageData.page,
		pageData.contentRef,
		renderedHtml,
		pageData.contentMountToken
	);
	useHashScroll(toc, pageData.contentRef, pageData.page?.slug);
	const attach = useWikiAttachments(workspaceSlug, pageData.page);
	const editState = useWikiEditing(
		workspaceSlug,
		pageData.page,
		pageData.revisionsLoaded ? (pageData.revisions[0]?.id ?? null) : undefined
	);
	const createForm = useCreatePageForm(workspaceSlug, projectId);
	const wikiTemplates = useWikiTemplates(workspaceSlug);
	const move = useMovePage(workspaceSlug, pageData.page);
	const verify = useWikiVerify(workspaceSlug, pageData.page);
	const restoreState = useWikiRestore(
		workspaceSlug,
		pageData.page,
		pageData.revisionsLoaded ? (pageData.revisions[0]?.id ?? null) : undefined,
		editState.editing
	);

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
	};
}

function useAssembledWikiPageProps(
	state: ReturnType<typeof useWikiPageState>,
	workspaceSlug?: string
) {
	const seed = useWikiSeed();
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
	} = state;

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
		navigate: (path: string) => navigateFeature(wikiHref(seed, path)),
	});

	const { latestRevision, breadcrumbs, showToc, createParentTitle, moveOptions } =
		deriveWikiPageState(pageData, pageMap, wikiPages, editState, createForm, toc);

	function startEdit() {
		move.cancelMove();
		editState.startEdit();
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
	});

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
	});

	return { navigateTo, startCreate, createProps, articleProps };
}

// PROJ-807: shown after deleting a page. No existing toast utility in apps/web/src —
// this is deliberately minimal (a fixed-position bar, not a general-purpose stack)
// rather than introducing a new shared abstraction for a single call site.
const UNDO_TOAST_TIMEOUT_MS = 8000;

// Each toast gets its own UndoToastBar instance (keyed per toast object), so undo/hover/
// focus state always starts fresh — no reset effect that could race a hover or focus
// arriving before it runs.
const undoToastKeys = new WeakMap<UndoToast, number>();
let nextUndoToastKey = 0;

function UndoToastView({ toast, onDismiss }: { toast: UndoToast | null; onDismiss: () => void }) {
	if (!toast) return null;
	let key = undoToastKeys.get(toast);
	if (key === undefined) {
		key = ++nextUndoToastKey;
		undoToastKeys.set(toast, key);
	}
	return <UndoToastBar key={key} toast={toast} onDismiss={onDismiss} />;
}

function UndoToastBar({ toast, onDismiss }: { toast: UndoToast; onDismiss: () => void }) {
	const [undoing, setUndoing] = useState(false);
	const [undoError, setUndoError] = useState<string | null>(null);
	const [hovered, setHovered] = useState(false);
	const [focusWithin, setFocusWithin] = useState(false);
	// Don't pull the toast out from under someone who is reading it, reaching for Undo
	// with a keyboard, or waiting on an Undo already in progress. Any of those resets the
	// countdown; it restarts in full once they're all false again.
	const paused = undoing || hovered || focusWithin;

	useEffect(() => {
		if (paused) return;
		const timer = setTimeout(onDismiss, UNDO_TOAST_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [paused, onDismiss]);

	const current = toast;

	async function handleUndo() {
		setUndoing(true);
		setUndoError(null);
		let result: string;
		try {
			result = await current.undo();
		} catch (e) {
			setUndoError(`Undo failed: ${String(e)}`);
			setUndoing(false);
			return;
		}
		onDismiss();
		try {
			await current.afterUndo?.(result);
		} catch {
			// The undo itself succeeded — a failed refresh afterwards isn't an undo failure.
		}
	}

	return (
		<div
			role="status"
			className={[
				"fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3",
				"bg-surface border border-border rounded shadow-lg px-4 py-3 text-sm text-text-base",
			].join(" ")}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocus={() => setFocusWithin(true)}
			onBlur={(e) => {
				const next = e.relatedTarget;
				if (!(next instanceof Node) || !e.currentTarget.contains(next)) setFocusWithin(false);
			}}
		>
			<span>{undoError ?? current.message}</span>
			{!undoError && (
				<Button variant="outline" size="sm" onClick={handleUndo} disabled={undoing}>
					{undoing ? "Undoing…" : "Undo"}
				</Button>
			)}
			<button
				type="button"
				aria-label="Dismiss"
				className="bg-transparent border-none cursor-pointer text-text-muted"
				onClick={onDismiss}
			>
				×
			</button>
		</div>
	);
}

export function WikiPageClient({ initial }: { readonly initial: WikiSeed }) {
	return (
		<SeedContext.Provider value={initial}>
			<WikiPageContent
				key={`${initial.workspaceSlug}:${initial.projectId}:${initial.slug}:${initial.mode}`}
				workspaceSlug={initial.workspaceSlug}
				projectId={initial.projectId}
				slug={initial.slug}
			/>
		</SeedContext.Provider>
	);
}
export default WikiPageClient;

function WikiPageContent({ workspaceSlug, projectId: projectIdProp, slug: slugProp }: Props) {
	const seed = useWikiSeed();
	const state = useWikiPageState(workspaceSlug, projectIdProp, slugProp);
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
	} = state;
	const { navigateTo, startCreate, createProps, articleProps } = useAssembledWikiPageProps(
		state,
		workspaceSlug
	);
	const dismissUndoToast = useCallback(() => setUndoToast(null), [setUndoToast]);

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
				onCreate={() => startCreate(null)}
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
					<meta property="og:title" content={pageData.page.title} />
					<meta property="og:description" content={excerptOf(pageData.page.content)} />
					<meta
						property="og:url"
						content={wikiHref(seed, `/wiki/${encodeURIComponent(pageData.page.slug)}`)}
					/>
				</>
			)}
		</>
	);
}
