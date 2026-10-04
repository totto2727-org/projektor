import type { HTMLAttributes, ReactNode } from "react";

export interface TableProps {
	class?: string;
	className?: string;
	children: ReactNode;
}
export function Table({ class: legacyClass, className, children }: TableProps) {
	return (
		<table
			className={["w-full border-collapse text-[0.9rem]", legacyClass, className]
				.filter(Boolean)
				.join(" ")}
		>
			{children}
		</table>
	);
}
export function TableHead({ children }: { children: ReactNode }) {
	return <thead>{children}</thead>;
}
export function TableBody({ children }: { children: ReactNode }) {
	return <tbody>{children}</tbody>;
}
export function TableRow({
	class: legacyClass,
	className,
	children,
	...props
}: HTMLAttributes<HTMLTableRowElement> & { class?: string; children: ReactNode }) {
	return (
		<tr {...props} className={[legacyClass, className].filter(Boolean).join(" ")}>
			{children}
		</tr>
	);
}
export function TableHeaderCell({
	class: legacyClass,
	className,
	children,
	...props
}: HTMLAttributes<HTMLTableCellElement> & { class?: string; children?: ReactNode }) {
	return (
		<th
			{...props}
			className={[
				"text-left px-3 py-2 border-b-2 border-border font-semibold text-text-base whitespace-nowrap",
				legacyClass,
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{children}
		</th>
	);
}
export function TableCell({
	class: legacyClass,
	className,
	muted,
	children,
	...props
}: HTMLAttributes<HTMLTableCellElement> & {
	class?: string;
	muted?: boolean;
	children: ReactNode;
}) {
	return (
		<td
			{...props}
			className={[
				"px-3 py-2 border-b border-border align-middle [tr:last-child_&]:border-b-0",
				muted && "font-mono text-[0.8rem] text-text-muted",
				legacyClass,
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{children}
		</td>
	);
}
export { TableHeaderCell as TableHeader };
