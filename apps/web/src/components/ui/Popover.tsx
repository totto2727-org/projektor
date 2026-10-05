"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { CSSProperties, ReactNode, Ref } from "react";
import { Popover as PrimitivePopover } from "../generated/popover";

/** Compatibility entry point backed by the framework portal, not app portal logic. */
export function Portal({ into, vnode }: { into: HTMLElement; vnode: ReactNode }) {
	return (
		<PrimitivePopover open>
			<PopoverPrimitive.Portal container={into}>{vnode}</PopoverPrimitive.Portal>
		</PrimitivePopover>
	);
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

/** Existing callers control visibility and supply coordinates, so no trigger is invented.
 * Base UI owns the popup and portal. The generated root shares the same context.
 * Generated PopoverContent cannot forward positioner anchors, so use its Base UI popup
 * directly for this compatibility-only coordinate surface, without modifying generation.
 */
export function Popover({
	id,
	role = "dialog",
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
					left: position.left,
					right: position.right,
					minWidth: position.width,
				}
			: undefined;
	const popup = (
		<PopoverPrimitive.Positioner
			style={
				strategy === "portal-fixed"
					? { ...style, transform: "none", visibility: "visible", zIndex: 50 }
					: { position: "static", transform: "none", visibility: "visible" }
			}
		>
			<PopoverPrimitive.Popup
				id={id}
				ref={elementRef}
				role={role}
				aria-label={ariaLabel}
				aria-modal={role === "dialog" ? ariaModal : undefined}
				initialFocus={false}
				finalFocus={false}
				className={[
					"popover rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10",
					legacyClass,
					className,
				]
					.filter(Boolean)
					.join(" ")}
			>
				{children}
			</PopoverPrimitive.Popup>
		</PopoverPrimitive.Positioner>
	);
	return (
		<PrimitivePopover open modal={ariaModal ?? false}>
			{strategy === "portal-fixed" ? (
				<PopoverPrimitive.Portal>{popup}</PopoverPrimitive.Portal>
			) : (
				popup
			)}
		</PrimitivePopover>
	);
}
