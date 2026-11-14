import { Schema } from 'effect'

export const WorkspaceBrand = Schema.Struct({
  displayName: Schema.NullOr(Schema.String),
  accent: Schema.NullOr(Schema.String),
  onAccent: Schema.NullOr(Schema.String),
  logoUrl: Schema.NullOr(Schema.String),
})
