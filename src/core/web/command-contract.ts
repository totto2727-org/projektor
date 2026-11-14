import { Schema } from 'effect'

import { WebRequestSchema } from './scope'

export const BrowserCommandSchema = Schema.Struct({
  request: WebRequestSchema,
  workspaceSlug: Schema.String,
  projectId: Schema.optional(Schema.String),
})
export type BrowserCommand = typeof BrowserCommandSchema.Type
export const CommandIdSchema = Schema.Struct({ id: Schema.String })
export const CreatedLinkAttachmentSchema = Schema.Struct({ id: Schema.String, kind: Schema.Literals(['url', 'wiki']) })
export const CommandOkSchema = Schema.Struct({ ok: Schema.Boolean })
export const CreatedIssueSchema = Schema.Struct({ id: Schema.String, number: Schema.Number })
export const ShareTokenSchema = Schema.Struct({ token: Schema.String, url: Schema.String })
