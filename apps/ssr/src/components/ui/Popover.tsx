"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";

export function Portal({ into, vnode }: { into: Element; vnode: ReactNode }) {
	return createPortal(vnode, into);
}
export interface PopoverProps {
	id?: string;
	role?: "dialog" | "menu" | "listbox";
	ariaLabel?: string;
	ariaModal?: boolean;
	elementRef?: Ref<HTMLDivElement>;
	class?: string;
	className?: string;
	strategy: "anchored" | "portal-fixed";
	position?: { top: number; left?: number; right?: number; width?: number };
	children: ReactNode;
}

/** Shared popover with in-place and body-portal modes matching the former island API. */
export function Popover({
	id,
	role,
	ariaLabel,
	ariaModal,
	elementRef,
	class: legacyClass,
	className,
	strategy,
	position,
	children,
}: PopoverProps) {
	if (strategy === "portal-fixed" && !position)
		throw new Error("Popover: `position` is required when strategy is 'portal-fixed'");
	const style: CSSProperties | undefined =
		strategy === "portal-fixed" && position
			? {
					position: "fixed",
					top: position.top,
					...(position.left === undefined ? {} : { left: position.left }),
					...(position.right === undefined ? {} : { right: position.right }),
					...(position.width === undefined ? {} : { minWidth: position.width }),
				}
			: undefined;
	const attributes = {
		id,
		ref: elementRef,
		className: ["popover", legacyClass, className].filter(Boolean).join(" "),
		style,
		children,
	};
	const element =
		role === "menu" ? (
			<div {...attributes} role="menu" aria-label={ariaLabel} />
		) : role === "listbox" ? (
			<div {...attributes} role="listbox" aria-label={ariaLabel} />
		) : (
			<div {...attributes} role="dialog" aria-label={ariaLabel} aria-modal={ariaModal} />
		);
	return strategy === "portal-fixed" && typeof document !== "undefined" ? (
		<Portal into={document.body} vnode={element} />
	) : (
		element
	);
}
