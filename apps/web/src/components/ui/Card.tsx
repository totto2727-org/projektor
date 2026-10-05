import type { AnchorHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card as PrimitiveCard } from "../generated/card";

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
		"p-4",
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
				<PrimitiveCard className="p-4">{children}</PrimitiveCard>
			</a>
		);
	return (
		<PrimitiveCard {...(rest as HTMLAttributes<HTMLDivElement>)} className={classes} style={style}>
			{children}
		</PrimitiveCard>
	);
}
