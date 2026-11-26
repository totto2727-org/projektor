import { Schema } from 'effect'

import { fieldsInOrder } from './ordered-fields.ts'
import type { FieldEntries, FieldsInOrder } from './ordered-fields.ts'

type SchemaFields = FieldEntries<Schema.Top>

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
  entries: Entries & (Extract<keyof Base, keyof FieldsInOrder<Entries>> extends never ? unknown : never),
): Schema.Struct<Base & FieldsInOrder<Entries>> {
  return Schema.Struct({ ...base, ...fieldsInOrder<Entries>(entries) })
}
