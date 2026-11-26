type FieldEntry<Value = unknown> = Readonly<[key: string, value: Value]>

export type FieldEntries<Value = unknown> = Readonly<FieldEntry<Value>[]>

type FieldName<Entry extends FieldEntry> = Entry extends Readonly<[infer Key extends string, unknown]> ? Key : never

type FieldValue<Entry extends FieldEntry> = Entry extends Readonly<[string, infer Value]> ? Value : never

export type FieldsInOrder<Entries extends FieldEntries> = {
  [Entry in Entries[number] as FieldName<Entry>]: FieldValue<Entry>
}

export const fieldsInOrder = function fieldsInOrder<const Entries extends FieldEntries>(
  entries: Entries,
): FieldsInOrder<Entries> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The tuples pair each key with its value type, and Object.fromEntries preserves their order.
  return Object.fromEntries(entries) as FieldsInOrder<Entries>
}
