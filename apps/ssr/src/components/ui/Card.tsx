import type { AnchorHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";

export type CardProps =
	| ({
			as?: "div";
			href?: never;
			interactive?: boolean;
			class?: string;
			className?: string;
			style?: CSSProperties;
			children: ReactNode;
	  } & HTMLAttributes<HTMLDivElement>)
	| ({
			as: "a";
			href: string;
			interactive?: boolean;
			class?: string;
			className?: string;
			style?: CSSProperties;
			children: ReactNode;
	  } & AnchorHTMLAttributes<HTMLAnchorElement>);

export function Card({
	as = "div",
	href,
	interactive,
	class: legacyClass,
	className,
	style,
	children,
	...rest
}: CardProps) {
	const classes = [
		"flex flex-col gap-2 p-4 bg-surface border border-border rounded-lg",
		as === "a" && "no-underline",
		interactive && "transition-all duration-150 hover:border-accent hover:-translate-y-px",
		legacyClass,
		className,
	]
		.filter(Boolean)
		.join(" ");
	if (as === "a")
		return (
			<a
				{...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
				href={href}
				className={classes}
				style={style}
			>
				{children}
			</a>
		);
	return (
		<div {...(rest as HTMLAttributes<HTMLDivElement>)} className={classes} style={style}>
			{children}
		</div>
	);
}
