import { Schema } from 'effect'

import { structInOrder } from './ordered-schema.ts'

export const WorkspaceBrand = structInOrder([
  ['displayName', Schema.NullOr(Schema.String)],
  ['accent', Schema.NullOr(Schema.String)],
  ['onAccent', Schema.NullOr(Schema.String)],
  ['logoUrl', Schema.NullOr(Schema.String)],
])
