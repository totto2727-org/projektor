"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Popover } from "../../components/ui/Popover";
import { METRIC_DEFINITIONS, type MetricId } from "./metric-definitions";

export function computeMetricHelpPosition(rect: DOMRect): { top: number; left: number } {
	const left = Math.max(8, Math.min(rect.left, window.innerWidth - 256 - 8));
	const below = window.innerHeight - rect.bottom - 4 - 8;
	const above = rect.top - 4 - 8;
	const top = below < 140 && above > below ? Math.max(8, rect.top - 4 - 140) : rect.bottom + 4;
	return { top, left };
}
/** Original viewport-clamped toggletip, dismissed by Escape, outside clicks and scroll. */
export function MetricHelp({ id }: { id: MetricId }) {
	const definition = METRIC_DEFINITIONS[id];
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
	const root = useRef<HTMLSpanElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const popoverId = useId();
	const reposition = useCallback(() => {
		const rect = trigger.current?.getBoundingClientRect();
		if (rect) setPosition(computeMetricHelpPosition(rect));
	}, []);
	useEffect(() => {
		if (!open) return;
		const inside = (node: Node) => root.current?.contains(node) || panel.current?.contains(node);
		const pointer = (event: MouseEvent) => {
			if (!(event.target instanceof Node) || !inside(event.target)) setOpen(false);
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		const scroll = (event: Event) => {
			if (!(event.target instanceof Node) || !inside(event.target)) setOpen(false);
		};
		let width = window.innerWidth;
		const resize = () => {
			if (window.innerWidth !== width) {
				width = window.innerWidth;
				setOpen(false);
			} else reposition();
		};
		const viewport = window.visualViewport;
		document.addEventListener("mousedown", pointer);
		document.addEventListener("keydown", key);
		window.addEventListener("scroll", scroll, true);
		window.addEventListener("resize", resize);
		viewport?.addEventListener("resize", resize);
		return () => {
			document.removeEventListener("mousedown", pointer);
			document.removeEventListener("keydown", key);
			window.removeEventListener("scroll", scroll, true);
			window.removeEventListener("resize", resize);
			viewport?.removeEventListener("resize", resize);
		};
	}, [open, reposition]);
	return (
		<span className="metric-help" ref={root}>
			<button
				ref={trigger}
				type="button"
				className="metric-help-trigger"
				aria-label={`About ${definition.label}`}
				aria-expanded={open}
				aria-describedby={open ? popoverId : undefined}
				onClick={() => {
					if (open) setOpen(false);
					else {
						reposition();
						setOpen(true);
					}
				}}
			>
				<span aria-hidden="true">ⓘ</span>
			</button>
			{open && position && (
				<Popover
					id={popoverId}
					strategy="portal-fixed"
					className="popover-metric-help"
					role="dialog"
					ariaModal={false}
					ariaLabel={`${definition.label} definition`}
					elementRef={panel}
					position={position}
				>
					<p className="m-0 mb-1 text-[0.8rem] text-text-base">{definition.definition}</p>
					<p className="m-0 text-[0.72rem] text-text-muted">{definition.computation}</p>
				</Popover>
			)}
		</span>
	);
}
export function SectionHeading({ metricId, caption }: { metricId: MetricId; caption?: string }) {
	return (
		<>
			<h2 className="m-0 mb-1 text-base font-semibold text-text-base inline-flex items-center gap-1.5">
				{METRIC_DEFINITIONS[metricId].label}
				<MetricHelp id={metricId} />
			</h2>
			{caption && <p className="m-0 mb-3 text-[0.72rem] text-text-muted">{caption}</p>}
		</>
	);
}
