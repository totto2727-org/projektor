import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

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

/** The shared `.btn` primitive with the legacy button, link, and label modes. */
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
		"btn",
		variant && `btn-${variant}`,
		size === "sm" && "btn-sm",
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
		<button
			{...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
			type={(rest as ButtonHTMLAttributes<HTMLButtonElement>).type ?? "button"}
			className={classes}
			style={style}
		>
			{children}
		</button>
	);
}
