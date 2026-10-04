"use client";

import { type ReactNode, useEffect, useRef } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
	open: boolean;
	onClose: () => void;
	ariaLabel?: string;
	title?: string;
	class?: string;
	className?: string;
	children: ReactNode;
}

/** Modal dialog that restores focus, locks scrolling, and retains the legacy focus trap. */
export function Dialog({
	open,
	onClose,
	ariaLabel,
	title,
	class: legacyClass,
	className,
	children,
}: DialogProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<Element | null>(null);
	useEffect(() => {
		if (!open) return;
		triggerRef.current = document.activeElement;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		(panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panelRef.current)?.focus();
		return () => {
			document.body.style.overflow = previousOverflow;
			if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
		};
	}, [open]);
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.defaultPrevented) {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== "Tab") return;
			const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
			const first = items[0];
			const last = items.at(-1);
			if (!first || !last) {
				event.preventDefault();
				return;
			}
			if (
				!panelRef.current?.contains(document.activeElement) ||
				(event.shiftKey && document.activeElement === first)
			) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);
	if (!open) return null;
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={ariaLabel ?? title}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !event.defaultPrevented) {
					event.preventDefault();
					onClose();
				}
			}}
			className="fixed inset-0 z-[120] flex items-start justify-center pt-12 bg-black/40 max-sm:items-end max-sm:pt-0"
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={panelRef}
				className={[
					"bg-bg border border-border rounded-lg p-6 w-full max-w-[480px] max-h-[80dvh] overflow-y-auto overscroll-contain mx-4 max-sm:rounded-t-lg max-sm:rounded-b-none max-sm:max-h-[90dvh] max-sm:mx-0 max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
					legacyClass,
					className,
				]
					.filter(Boolean)
					.join(" ")}
				tabIndex={-1}
			>
				{children}
			</div>
		</div>
	);
}
