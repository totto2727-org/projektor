import type { ReactNode } from "react";
import {
	Field as PrimitiveField,
	FieldLabel,
	FieldDescription,
	FieldError,
} from "../generated/field";

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
		<PrimitiveField
			data-invalid={!!error || undefined}
			className={["mb-3", legacyClass, className].filter(Boolean).join(" ")}
		>
			<FieldLabel htmlFor={htmlFor}>
				{label}
				{required && (
					<span aria-hidden="true" className="text-accent">
						{" "}
						*
					</span>
				)}
			</FieldLabel>
			{children}
			{error ? (
				<FieldError>{error}</FieldError>
			) : (
				(help ?? hint) && <FieldDescription>{help ?? hint}</FieldDescription>
			)}
		</PrimitiveField>
	);
}
