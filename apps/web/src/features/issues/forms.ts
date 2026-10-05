"use client";
import { type DeepValue, useForm, useStore } from "@tanstack/react-form";
import { Schema } from "effect";
import { type Dispatch, type SetStateAction, useRef } from "react";

export const Text = Schema.String;
export const RequiredText = Schema.String.check(Schema.isPattern(/\S/));
export const TitleText = RequiredText.check(Schema.isMaxLength(500));
export const BodyText = Text.check(Schema.isMaxLength(50000));
export const CommentText = RequiredText.check(Schema.isMaxLength(10000));
export const Priority = Schema.Literals(["urgent", "high", "medium", "low", "none"]);
export const IssueReference = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]*-\d+$/));
export const PointsText = Schema.String.check(
	Schema.isPattern(/^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?$/),
);
export const UrlText = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/i));

/** TanStack owns editable values and Effect owns validation. Canonical DTO refreshes never reset unsaved input. */
export function useIssueForm<Values extends Record<string, unknown>>(
	defaultValues: Values,
	schema: Schema.ConstraintDecoder<unknown>,
) {
	// Effect decoders accept unknown input. TanStack supplies the narrower Values type.
	const validator = Schema.toStandardSchemaV1(schema as Schema.Codec<unknown, Values>);
	const form = useForm({
		defaultValues,
		validators: { onChange: validator, onSubmit: validator },
	});
	const values = useStore(form.store, (state) => state.values);
	const isValid = useStore(form.store, (state) => state.isValid);
	const setters = useRef(new Map<string, (next: unknown) => void>());
	function field<Key extends keyof Values & string>(
		name: Key,
	): [Values[Key], Dispatch<SetStateAction<Values[Key]>>] {
		let setter = setters.current.get(name);
		if (!setter) {
			setter = (next: unknown) => {
				const value =
					typeof next === "function"
						? (next as (previous: Values[Key]) => Values[Key])(form.state.values[name])
						: (next as Values[Key]);
				form.setFieldValue(name, value as DeepValue<Values, Key>);
			};
			setters.current.set(name, setter);
		}
		return [values[name], setter];
	}
	async function validate() {
		await form.validate("submit");
		return form.state.isValid;
	}
	return { form, values, isValid, field, validate };
}
