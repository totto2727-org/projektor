import { Schema } from 'effect'

const StringSchema = Schema.String
const NS = Schema.NullOr(StringSchema)
export const ApiConsentWorkspace = Schema.NullOr(
  Schema.Struct({ id: StringSchema, name: StringSchema, slug: StringSchema, role: StringSchema }),
)
export const ApiSubmittedFeedback = Schema.Struct({ id: StringSchema, corsAllowOrigin: NS })
export const ApiSharedIssue = Schema.Struct({
  title: StringSchema,
  body: NS,
  priority: StringSchema,
  status_name: NS,
  status_category: NS,
  project_key: NS,
  project_name: NS,
  assignee_name: NS,
  created_at: Schema.Number,
  expires_at: Schema.Number,
  customFields: Schema.Array(
    Schema.Struct({ key: StringSchema, label: StringSchema, type: StringSchema, value: StringSchema }),
  ),
  brand: Schema.Struct({ displayName: NS, accent: NS, onAccent: NS, fontFamily: NS, fontUrl: NS, logoUrl: NS }),
})
export const ApiRealtimeSnapshot = Schema.Struct({
  userId: StringSchema,
  workspaceId: StringSchema,
  role: Schema.Literals(['owner', 'admin', 'member', 'viewer']),
  visibleProjectIds: Schema.Array(StringSchema),
})
