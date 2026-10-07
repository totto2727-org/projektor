"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RequestScope } from "../server/request-context";
import { scopedHref } from "../urls";

export { scopedHref };

export interface ProjectNavProps {
	scope: RequestScope;
	url: string;
}

const TABS = [
	{ label: "Overview", path: "/projects/view" },
	{ label: "Issues", path: "/issues" },
	{ label: "Wiki", path: "/wiki" },
	{ label: "Sprints", path: "/sprints" },
	{ label: "Epics", path: "/epics" },
	{ label: "Metrics", path: "/metrics" },
	{ label: "Feedback", path: "/feedback" },
] as const;
const KEY_BADGE_CLASS =
	"font-mono text-[0.72rem] font-medium px-[0.4rem] py-[0.1rem] rounded-[3px] bg-surface border border-border text-text-muted";
const TAB_BASE_CLASS =
	"inline-flex items-center shrink-0 whitespace-nowrap px-3 py-2 rounded-t-md text-sm font-medium no-underline border border-b-0 -mb-px transition-[color,background] duration-100 max-sm:px-2.5 max-sm:py-1.5 max-sm:text-[0.8125rem]";
const MORE_TRIGGER_RESERVE_PX = 84;
const TAB_GAP_PX = 2;

function normalPath(pathname: string): string {
	return pathname === "/" ? pathname : pathname.replace(/\/+$/, "") || "/";
}
function isTabActive(path: string, pathname: string): boolean {
	const current = normalPath(pathname);
	return path === "/projects/view"
		? current === path || current.startsWith(`${path}/`)
		: current === path;
}
function tabClass(active: boolean): string {
	return `${TAB_BASE_CLASS} ${active ? "text-accent bg-bg border-border font-semibold" : "text-text-muted border-transparent hover:text-text-base hover:bg-surface"}`;
}
function visibleCount(width: number, tabs: readonly number[]): number {
	const total =
		tabs.reduce((sum, item) => sum + item, 0) + TAB_GAP_PX * Math.max(tabs.length - 1, 0);
	if (total <= width) return tabs.length;
	let used = 0;
	for (let index = 0; index < tabs.length; index += 1) {
		const next = used + tabs[index] + (index ? TAB_GAP_PX : 0);
		if (next + TAB_GAP_PX + MORE_TRIGGER_RESERVE_PX > width) return index;
		used = next;
	}
	return tabs.length;
}

/** Project-family header navigation. Server scope is authoritative, and no client project lookup occurs. */
export function ProjectNav({ scope, url }: ProjectNavProps) {
	const [width, setWidth] = useState(0);
	const [tabWidths, setTabWidths] = useState<number[] | null>(null);
	const [moreOpen, setMoreOpen] = useState(false);
	const navRef = useRef<HTMLElement>(null);
	const measureRefs = useRef<Array<HTMLAnchorElement | null>>([]);
	const moreRef = useRef<HTMLDivElement>(null);
	const moreTrigger = useRef<HTMLButtonElement>(null);
	const menuId = useId();
	const parsed = new URL(url, "http://projektor.local");
	const pathname = normalPath(parsed.pathname);
	const project = scope.selection.kind === "project" ? scope.selection.project : null;
	const workspace = scope.selection.kind === "project" ? scope.selection.workspace : null;
	useLayoutEffect(() => {
		const element = navRef.current;
		if (!element || !project) return;
		const measure = () => {
			setWidth(
				element.clientWidth -
					Number.parseFloat(getComputedStyle(element).paddingLeft || "0") -
					Number.parseFloat(getComputedStyle(element).paddingRight || "0"),
			);
			const next = measureRefs.current.map((item) => item?.offsetWidth ?? 0);
			if (next.every(Boolean)) setTabWidths(next);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		document.fonts?.ready.then(measure);
		return () => observer.disconnect();
	}, [project]);
	useEffect(() => {
		if (!moreOpen) return;
		const outside = (event: MouseEvent) => {
			if (event.target instanceof Node && !moreRef.current?.contains(event.target))
				setMoreOpen(false);
		};
		const onEscapeKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMoreOpen(false);
				moreTrigger.current?.focus();
			}
		};
		document.addEventListener("mousedown", outside);
		document.addEventListener("keydown", onEscapeKey);
		return () => {
			document.removeEventListener("mousedown", outside);
			document.removeEventListener("keydown", onEscapeKey);
		};
	}, [moreOpen]);
	const tabs = useMemo(
		() =>
			!project
				? []
				: TABS.map((tab) => ({
						...tab,
						href: scopedHref(
							tab.path === "/projects/view" && project.slug
								? `/projects/view/${encodeURIComponent(project.slug)}`
								: tab.path,
							scope,
						),
					})),
		[project, scope],
	);
	const count = tabWidths && width > 0 ? visibleCount(width, tabWidths) : tabs.length;
	if (!project || !workspace)
		return (
			<p role="alert" className="text-danger-text px-3 py-2 text-sm">
				Choose a project from <a href="/">Projects</a>.
			</p>
		);
	const visible = tabs.slice(0, count);
	const overflow = tabs.slice(count);
	const activeOverflow = overflow.some((tab) => isTabActive(tab.path, pathname));
	const overviewHref = scopedHref(
		project.slug ? `/projects/view/${encodeURIComponent(project.slug)}` : "/projects/view",
		scope,
	);
	return (
		<div className="border-b border-border bg-nav-bg">
			<div className="flex items-center gap-2 px-6 pt-3 pb-[0.375rem] max-sm:px-3 max-sm:pt-1.5 max-sm:pb-1">
				<a href={overviewHref} className="no-underline">
					<h2 className="m-0 text-[0.9375rem] max-sm:text-[0.8125rem] font-semibold text-text-base">
						{project.name}
					</h2>
				</a>
				<span className={KEY_BADGE_CLASS}>{project.key}</span>
			</div>
			<nav
				ref={navRef}
				// Before client measurement, every server-rendered link remains reachable
				// through native scrolling without widening the document. The measured
				// More menu keeps visible overflow so its popup is not clipped.
				className={`flex flex-nowrap items-center gap-0.5 px-5 max-sm:px-3 ${overflow.length === 0 ? "overflow-x-auto" : ""}`}
				aria-label="Project sections"
			>
				{visible.map((tab, index) => {
					const active = isTabActive(tab.path, pathname);
					return (
						<a
							key={tab.path}
							ref={(element) => {
								measureRefs.current[index] = element;
							}}
							href={tab.href}
							className={tabClass(active)}
							aria-current={active ? "page" : undefined}
						>
							{tab.label}
						</a>
					);
				})}
				{overflow.length > 0 && (
					<div ref={moreRef} className="relative inline-flex items-center shrink-0">
						<button
							ref={moreTrigger}
							type="button"
							className={tabClass(activeOverflow || moreOpen)}
							aria-haspopup="menu"
							aria-expanded={moreOpen}
							aria-controls={moreOpen ? menuId : undefined}
							aria-current={activeOverflow ? "true" : undefined}
							onClick={() => setMoreOpen((open) => !open)}
						>
							More <span aria-hidden="true">▾</span>
						</button>
						{moreOpen && (
							<div
								id={menuId}
								role="menu"
								aria-label="More project sections"
								className="absolute right-0 top-full z-10 mt-1 flex min-w-[10rem] flex-col rounded-md border border-border bg-bg py-1 shadow-md"
							>
								{overflow.map((tab) => {
									const active = isTabActive(tab.path, pathname);
									return (
										<a
											key={tab.path}
											role="menuitem"
											href={tab.href}
											className="flex min-h-11 items-center gap-1.5 px-3 text-sm font-medium text-text-base no-underline hover:bg-surface"
											aria-current={active ? "page" : undefined}
											onClick={() => setMoreOpen(false)}
										>
											{tab.label}
										</a>
									);
								})}
							</div>
						)}
					</div>
				)}
			</nav>
		</div>
	);
}
