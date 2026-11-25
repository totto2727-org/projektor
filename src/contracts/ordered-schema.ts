import { Schema } from 'effect'

type SchemaField = Readonly<[name: string, codec: Schema.Top]>

type SchemaFields = Readonly<SchemaField[]>

type FieldName<Field extends SchemaField> =
  Field extends Readonly<[infer Name extends string, Schema.Top]> ? Name : never

type FieldCodec<Field extends SchemaField> =
  Field extends Readonly<[string, infer Codec extends Schema.Top]> ? Codec : never

type FieldsInOrder<Entries extends SchemaFields> = {
  [Entry in Entries[number] as FieldName<Entry>]: FieldCodec<Entry>
}

export const fieldsInOrder = function fieldsInOrder<const Entries extends SchemaFields>(
  entries: Entries,
): FieldsInOrder<Entries> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The entry tuples preserve each schema type and the order of decoding, encoding, and validation.
  return Object.fromEntries(entries) as FieldsInOrder<Entries>
}

export const structInOrder = function structInOrder<const Entries extends SchemaFields>(
  entries: Entries,
): Schema.Struct<FieldsInOrder<Entries>> {
  return Schema.Struct(fieldsInOrder(entries))
}

export const extendStructInOrder = function extendStructInOrder<
  Base extends Schema.Struct.Fields,
  const Entries extends SchemaFields,
>(
  base: Base,
  entries: Entries & (Extract<keyof Base, FieldName<Entries[number]>> extends never ? unknown : never),
): Schema.Struct<Base & FieldsInOrder<Entries>> {
  return Schema.Struct({ ...base, ...fieldsInOrder<Entries>(entries) })
}
