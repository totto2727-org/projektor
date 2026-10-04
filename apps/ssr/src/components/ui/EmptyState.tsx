import type { ReactNode } from "react";

export interface EmptyStateProps {
	title: string;
	description?: string;
	action?: ReactNode;
	icon?: ReactNode;
	class?: string;
	className?: string;
}
export function EmptyState({
	title,
	description,
	action,
	icon,
	class: legacyClass,
	className,
}: EmptyStateProps) {
	return (
		<div
			className={[
				"flex flex-col items-center justify-center gap-2 py-12 px-4 text-center",
				legacyClass,
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{icon}
			<p className="text-sm font-medium text-text-base">{title}</p>
			{description && <p className="text-xs text-text-muted max-w-[28rem]">{description}</p>}
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
