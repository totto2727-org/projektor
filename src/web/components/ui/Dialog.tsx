"use client";

import type { ReactNode } from "react";
import { Dialog as PrimitiveDialog, DialogContent, DialogTitle } from "../generated/dialog";

export interface DialogProps {
	open: boolean;
	onClose: () => void;
	ariaLabel?: string;
	title?: string;
	class?: string;
	className?: string;
	children: ReactNode;
}

/** Base UI owns portals, modal focus, dismissal, and scroll locking. */
export function Dialog({
	open,
	onClose,
	ariaLabel,
	title,
	class: legacyClass,
	className,
	children,
}: DialogProps) {
	return (
		<PrimitiveDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) onClose();
			}}
		>
			<DialogContent
				aria-label={ariaLabel}
				className={["max-h-[80dvh] overflow-y-auto sm:max-w-[480px]", legacyClass, className]
					.filter(Boolean)
					.join(" ")}
			>
				<DialogTitle className="sr-only">{title ?? ariaLabel ?? "Dialog"}</DialogTitle>
				{children}
			</DialogContent>
		</PrimitiveDialog>
	);
}
