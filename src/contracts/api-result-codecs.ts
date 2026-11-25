import { Schema } from 'effect'

export const array = <Item extends Schema.Top>(item: Item): Schema.mutable<Schema.$Array<Item>> =>
  Schema.mutable(Schema.Array(item))

export const StringSchema = Schema.String

export const NumberSchema = Schema.Number

export const BooleanSchema = Schema.Boolean

export const NS = Schema.NullOr(StringSchema)

export const NN = Schema.NullOr(NumberSchema)

export const Id = Schema.Struct({ id: StringSchema })

export const Ok = Schema.Struct({ ok: BooleanSchema })

export const Named = Schema.Struct({ id: StringSchema, name: StringSchema })

export const Keyed = Schema.Struct({ id: StringSchema, key: StringSchema, name: StringSchema })

export const CreatedIssue = Schema.Struct({ id: StringSchema, number: Schema.optional(NumberSchema) })
