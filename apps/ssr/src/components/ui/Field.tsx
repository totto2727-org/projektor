import type { ReactNode } from "react";

export interface FieldProps {
	label: ReactNode;
	htmlFor: string;
	required?: boolean;
	help?: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	class?: string;
	className?: string;
	children: ReactNode;
}

export function Field({
	label,
	htmlFor,
	required,
	help,
	hint,
	error,
	class: legacyClass,
	className,
	children,
}: FieldProps) {
	return (
		<div className={["mb-3", legacyClass, className].filter(Boolean).join(" ")}>
			<label htmlFor={htmlFor} className="block mb-1 text-xs font-semibold text-text-muted">
				{label}
				{required && (
					<span aria-hidden="true" className="text-accent">
						{" "}
						*
					</span>
				)}
			</label>
			{children}
			{error ? (
				<p role="alert" className="mt-1 text-xs text-danger-text">
					{error}
				</p>
			) : (
				(help ?? hint) && <p className="mt-1 text-xs text-text-muted">{help ?? hint}</p>
			)}
		</div>
	);
}
