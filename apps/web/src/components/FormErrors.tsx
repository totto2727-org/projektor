import type { ReactNode } from "react";

/** Structural subset shared by Standard Schema issues and TanStack Form error values. */
export interface FormIssue {
	readonly message?: unknown;
}

export interface FormErrorsProps {
	errors?: unknown;
	id?: string;
	className?: string;
	"aria-label"?: string;
}

function messagesFrom(error: unknown): string[] {
	if (typeof error === "string" && error.trim()) return [error];
	if (Array.isArray(error)) return error.flatMap(messagesFrom);
	if (!error || typeof error !== "object") return [];
	const issue = error as FormIssue & { readonly errors?: unknown; readonly errorMap?: unknown };
	if (typeof issue.message === "string" && issue.message.trim()) return [issue.message];
	const errorMap =
		issue.errorMap && typeof issue.errorMap === "object"
			? Object.values(issue.errorMap).flatMap(messagesFrom)
			: messagesFrom(issue.errorMap);
	return [messagesFrom(issue.errors), errorMap].flat();
}

/**
 * Renders the message-bearing portion of Standard Schema and TanStack Form errors.
 * Form state and validation remain owned by the calling form.
 */
export function FormErrors({
	errors,
	id,
	className,
	"aria-label": ariaLabel = "Validation errors",
}: FormErrorsProps): ReactNode {
	const messages = [...new Set(messagesFrom(errors))];
	if (messages.length === 0) return null;
	const classes = ["mt-1 text-xs text-danger-text", className].filter(Boolean).join(" ");
	if (messages.length === 1)
		return (
			<p id={id} role="alert" className={classes}>
				{messages[0]}
			</p>
		);
	return (
		<div id={id} role="alert" aria-label={ariaLabel} className={classes}>
			<ul className="m-0 list-disc pl-4">
				{messages.map((message) => (
					<li key={message}>{message}</li>
				))}
			</ul>
		</div>
	);
}
