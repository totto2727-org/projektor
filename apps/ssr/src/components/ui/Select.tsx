"use client";

import {
	type CSSProperties,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

export interface SelectOption {
	value: string;
	label: string;
	action?: { ariaLabel: string; icon?: string; onClick: () => void };
}
export interface SelectProps {
	value: string;
	options: readonly SelectOption[];
	onChange: (value: string) => void;
	ariaLabel: string;
	disabled?: boolean;
	buttonStyle?: CSSProperties;
	capitalize?: boolean;
	buttonClass?: string;
	placeholder?: string;
	class?: string;
	className?: string;
}
const mobileMenu = () =>
	typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

/** Legacy combobox/listbox behavior, including option actions and mobile sheet scroll locking. */
export function Select({
	options,
	value,
	onChange,
	ariaLabel,
	disabled = false,
	buttonStyle,
	capitalize = false,
	buttonClass,
	placeholder,
	class: legacyClass,
	className,
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const [highlight, setHighlight] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const id = useId();
	const selectedIndex = options.findIndex((option) => option.value === value);
	const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
	const label = selected?.label ?? (value || placeholder || "");
	const close = useCallback(() => setOpen(false), []);
	const openMenu = useCallback(() => {
		if (!disabled) {
			setHighlight(Math.max(0, selectedIndex));
			setOpen(true);
		}
	}, [disabled, selectedIndex]);
	const choose = useCallback(
		(index: number) => {
			const option = options[index];
			if (option) onChange(option.value);
			close();
		},
		[close, onChange, options]
	);
	useEffect(() => {
		if (highlight > options.length - 1) setHighlight(Math.max(0, options.length - 1));
	}, [highlight, options.length]);
	useEffect(() => {
		if (!open) return;
		const previousOverflow = mobileMenu() ? document.body.style.overflow : undefined;
		if (mobileMenu()) document.body.style.overflow = "hidden";
		const outside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target) &&
				!menuRef.current?.contains(event.target)
			)
				close();
		};
		const resize = () => close();
		document.addEventListener("pointerdown", outside);
		window.addEventListener("resize", resize);
		return () => {
			document.removeEventListener("pointerdown", outside);
			window.removeEventListener("resize", resize);
			if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow;
		};
	}, [close, open]);
	useEffect(() => {
		if (!open || document.activeElement?.getAttribute("role") !== "option") return;
		if (menuRef.current?.contains(document.activeElement)) {
			menuRef.current.querySelectorAll<HTMLElement>('[role="option"]').item(highlight)?.focus();
		}
	}, [highlight, open]);
	function onKeyDown(event: KeyboardEvent<HTMLButtonElement | HTMLDivElement>) {
		if (disabled) return;
		if (!open && ["ArrowDown", "Enter", " "].includes(event.key)) {
			event.preventDefault();
			openMenu();
			return;
		}
		if (!open) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setHighlight((item) => Math.min(item + 1, options.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setHighlight((item) => Math.max(0, item - 1));
		} else if (event.key === "Home") {
			event.preventDefault();
			setHighlight(0);
		} else if (event.key === "End") {
			event.preventDefault();
			setHighlight(Math.max(0, options.length - 1));
		} else if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			choose(highlight);
		} else if (event.key === "Escape") {
			event.preventDefault();
			close();
			triggerRef.current?.focus();
		} else if (event.key === "Tab") close();
		else if ((event.key === "Delete" || event.key === "Backspace") && options[highlight]?.action) {
			event.preventDefault();
			options[highlight].action?.onClick();
		}
	}
	return (
		<div ref={rootRef} className={["select", legacyClass, className].filter(Boolean).join(" ")}>
			<button
				ref={triggerRef}
				type="button"
				role="combobox"
				className={["select-button", buttonClass].filter(Boolean).join(" ")}
				style={{ textTransform: capitalize ? "capitalize" : undefined, ...buttonStyle }}
				disabled={disabled}
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={`${id}-menu`}
				aria-activedescendant={open ? `${id}-opt-${highlight}` : undefined}
				onClick={() => (open ? close() : openMenu())}
				onKeyDown={onKeyDown}
			>
				<span>{label}</span>
				<span className="select-caret" aria-hidden="true">
					▾
				</span>
			</button>
			{open && (
				<div
					ref={menuRef}
					id={`${id}-menu`}
					className="select-menu"
					role="listbox"
					tabIndex={-1}
					aria-label={ariaLabel}
				>
					{options.map((option, index) => (
						<div
							key={option.value}
							id={`${id}-opt-${index}`}
							role="option"
							tabIndex={-1}
							onFocus={(event) => {
								if (event.target === event.currentTarget) setHighlight(index);
							}}
							onKeyDown={(event) => {
								if (event.target !== event.currentTarget) return;
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									choose(index);
									triggerRef.current?.focus();
								} else onKeyDown(event);
							}}
							aria-selected={option.value === value}
							aria-label={option.action ? option.label : undefined}
							data-selected={option.value === value || undefined}
							className={index === highlight ? "select-option highlighted" : "select-option"}
							style={{ textTransform: capitalize ? "capitalize" : undefined }}
							onPointerMove={() => setHighlight(index)}
							onClick={() => choose(index)}
						>
							{option.action ? <span className="grow">{option.label}</span> : option.label}
							{option.action && (
								<button
									type="button"
									aria-label={option.action.ariaLabel}
									className="ml-auto bg-transparent border-none cursor-pointer text-text-muted px-[0.2rem] py-0 text-[0.85rem] leading-none shrink-0"
									onClick={(event) => {
										event.stopPropagation();
										option.action?.onClick();
									}}
								>
									{option.action.icon ?? "×"}
								</button>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
export default Select;
