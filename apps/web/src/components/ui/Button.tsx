import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Button as PrimitiveButton, buttonVariants } from "../generated/button";

type CommonProps = {
	variant?: "primary" | "outline" | "danger";
	size?: "sm";
	class?: string;
	className?: string;
	style?: CSSProperties;
	children: ReactNode;
};
export type ButtonProps = CommonProps &
	(
		| ({ as?: "button"; href?: never } & ButtonHTMLAttributes<HTMLButtonElement>)
		| ({ as: "a"; href: string } & AnchorHTMLAttributes<HTMLAnchorElement>)
		| { as: "span"; href?: never }
	);

/** Compatibility props only. Base UI owns button interaction and native form semantics. */
export function Button({
	variant,
	size,
	as = "button",
	href,
	class: legacyClass,
	className,
	style,
	children,
	...rest
}: ButtonProps) {
	const classes = [
		as !== "button" &&
			buttonVariants({
				variant:
					variant === "danger" ? "destructive" : variant === "outline" ? "outline" : "default",
				size,
			}),
		legacyClass,
		className,
	]
		.filter(Boolean)
		.join(" ");
	if (as === "span")
		return (
			<span className={classes} style={style}>
				{children}
			</span>
		);
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
		<PrimitiveButton
			{...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
			type={(rest as ButtonHTMLAttributes<HTMLButtonElement>).type ?? "button"}
			variant={variant === "danger" ? "destructive" : variant === "outline" ? "outline" : "default"}
			size={size}
			className={classes}
			style={style}
		>
			{children}
		</PrimitiveButton>
	);
}
