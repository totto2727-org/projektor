import { Schema } from 'effect'
import type { Predicate } from 'effect'

const NonEmptyText = Schema.NonEmptyString.pipe(Schema.brand('NonEmptyText'))

export const isNonEmptyText: Predicate.Refinement<unknown, typeof NonEmptyText.Type> = Schema.is(NonEmptyText)

export const firstCodePoint = (value: string): string | undefined => value[Symbol.iterator]().next().value

export const firstNonEmptyText = (...values: (string | null | undefined)[]): string | undefined =>
  values.find((value) => isNonEmptyText(value))

export const trimNonEmptyText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return isNonEmptyText(trimmed) ? trimmed : undefined
}
