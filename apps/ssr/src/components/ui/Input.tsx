import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";

const BASE_CLASS =
	"w-full px-[0.625rem] py-[0.4rem] border border-border rounded text-[0.875rem] bg-bg text-text-base font-[inherit] focus:outline-[2px] focus:outline-accent focus:outline-offset-1 disabled:opacity-60 disabled:cursor-not-allowed";
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	class?: string;
	inputRef?: Ref<HTMLInputElement>;
}
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	class?: string;
	inputRef?: Ref<HTMLTextAreaElement>;
}
export function Input({ class: legacyClass, className, inputRef, ...props }: InputProps) {
	return (
		<input
			{...props}
			ref={inputRef}
			className={[BASE_CLASS, legacyClass, className].filter(Boolean).join(" ")}
		/>
	);
}
export function Textarea({ class: legacyClass, className, inputRef, ...props }: TextareaProps) {
	return (
		<textarea
			{...props}
			ref={inputRef}
			className={[BASE_CLASS, legacyClass, className].filter(Boolean).join(" ")}
		/>
	);
}
