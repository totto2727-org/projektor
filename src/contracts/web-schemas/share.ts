import { Schema } from 'effect'

import { WorkspaceBrand } from '../web-brand'

const nullable = Schema.NullOr(Schema.String)
export const SharedIssue = Schema.Struct({
  title: Schema.String,
  body: nullable,
  priority: Schema.String,
  status_name: nullable,
  status_category: nullable,
  project_key: nullable,
  project_name: nullable,
  assignee_name: nullable,
  created_at: Schema.Number,
  expires_at: Schema.Number,
  customFields: Schema.Array(
    Schema.Struct({ key: Schema.String, label: Schema.String, type: Schema.String, value: Schema.String }),
  ),
  brand: Schema.Struct({ ...WorkspaceBrand.fields, fontFamily: nullable, fontUrl: nullable }),
})
