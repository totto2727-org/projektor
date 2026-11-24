import { Schema } from 'effect'
import type { Predicate } from 'effect'

const NonEmptyText = Schema.NonEmptyString.pipe(Schema.brand('NonEmptyText'))

export const isNonEmptyText: Predicate.Refinement<unknown, typeof NonEmptyText.Type> = Schema.is(NonEmptyText)
