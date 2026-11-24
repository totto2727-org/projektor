'use client'
import { useForm, useStore } from '@tanstack/react-form'
import type { DeepValue } from '@tanstack/react-form'
import { Predicate, Schema } from 'effect'
import { useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'

export const Text = Schema.String
export const RequiredText = Schema.String.check(Schema.isPattern(/\S/))
export const TitleText = RequiredText.check(Schema.isMaxLength(500))
export const BodyText = Text.check(Schema.isMaxLength(50_000))
export const CommentText = RequiredText.check(Schema.isMaxLength(10_000))
export const Priority = Schema.Literals(['urgent', 'high', 'medium', 'low', 'none'])
export const IssueReference = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9]*-\d+$/))
export const PointsText = Schema.String.check(Schema.isPattern(/^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)?$/))
export const UrlText = Schema.URLFromString

/** TanStack owns editable values and Effect owns validation. Canonical DTO refreshes never reset unsaved input. */
export const useIssueForm = function useIssueForm<Values extends Record<string, unknown>>(
  defaultValues: Values,
  schema: Schema.Codec<unknown, NoInfer<Values>>,
) {
  const validator = Schema.toStandardSchemaV1(schema)
  const form = useForm({
    defaultValues,
    validators: { onChange: validator, onSubmit: validator },
  })
  const values = useStore(form.store, (state) => state.values)
  const isValid = useStore(form.store, (state) => state.isValid)
  const setters = useRef(new Map<string, (next: unknown) => void>())
  const field = function field<Key extends keyof Values & string>(
    name: Key,
  ): [Values[Key], Dispatch<SetStateAction<Values[Key]>>] {
    let setter = setters.current.get(name)
    if (!setter) {
      setter = (next: unknown) => {
        const value = Predicate.isFunction(next)
          ? (next as (previous: Values[Key]) => Values[Key])(form.state.values[name])
          : (next as Values[Key])
        form.setFieldValue(name, value as DeepValue<Values, Key>)
      }
      setters.current.set(name, setter)
    }
    return [values[name], setter]
  }
  const validate = async function validate(): Promise<boolean> {
    await form.validate('submit')
    return form.state.isValid
  }
  return { form, values, isValid, field, validate }
}
