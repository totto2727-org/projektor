import { Schema } from 'effect'

const S = Schema.String
const NS = Schema.NullOr(S)
export const ApiConsentWorkspace = Schema.NullOr(Schema.Struct({ id: S, name: S, slug: S, role: S }))
export const ApiSubmittedFeedback = Schema.Struct({ id: S, corsAllowOrigin: NS })
export const ApiSharedIssue = Schema.Struct({
  title: S,
  body: NS,
  priority: S,
  status_name: NS,
  status_category: NS,
  project_key: NS,
  project_name: NS,
  assignee_name: NS,
  created_at: Schema.Number,
  expires_at: Schema.Number,
  customFields: Schema.Array(Schema.Struct({ key: S, label: S, type: S, value: S })),
  brand: Schema.Struct({ displayName: NS, accent: NS, onAccent: NS, fontFamily: NS, fontUrl: NS, logoUrl: NS }),
})
export const ApiRealtimeSnapshot = Schema.Struct({
  userId: S,
  workspaceId: S,
  role: Schema.Literals(['owner', 'admin', 'member', 'viewer']),
  visibleProjectIds: Schema.Array(S),
})
