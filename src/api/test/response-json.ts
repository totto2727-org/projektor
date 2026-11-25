import { Data, Predicate, Schema } from 'effect'

export const ErrorMessageResponse = Schema.Struct({ error: Schema.String })
export const IdResponse = Schema.Struct({ id: Schema.String })
export const IdAndSlugResponse = Schema.Struct({ id: Schema.String, slug: Schema.String })
export const IdListResponse = Schema.Array(IdResponse).pipe(Schema.mutable)
export const JsonListResponse = Schema.Array(Schema.Unknown).pipe(Schema.mutable)
export const ItemsResponse = Schema.Struct({ items: JsonListResponse })
const RpcTextEntries = Schema.Array(Schema.Struct({ text: Schema.String })).pipe(Schema.mutable)
export const RpcTextResponse = Schema.Struct({
  result: Schema.Struct({
    content: RpcTextEntries,
  }),
})
export const McpRpcResponse = Schema.Struct({
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
  result: Schema.optional(
    Schema.Struct({
      content: Schema.optional(RpcTextEntries),
      isError: Schema.optional(Schema.Boolean),
    }),
  ),
})
export const SlugResponse = Schema.Struct({ slug: Schema.String })
export const SlugListResponse = Schema.Array(SlugResponse).pipe(Schema.mutable)
export const TitleListResponse = Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable)
export const TokenLinkResponse = Schema.Struct({ token: Schema.String, url: Schema.String })
export const TokenResponse = Schema.Struct({ token: Schema.String })
export const UnknownItemsResponse = Schema.Struct({ items: Schema.Unknown })
export const KeyListResponse = Schema.Array(Schema.Struct({ key: Schema.String })).pipe(Schema.mutable)
export const JsonRecordResponse = Schema.Record(Schema.String, Schema.Unknown)
export const TitleItemsResponse = Schema.Struct({ items: TitleListResponse })
export const IssueTitlesResponse = Schema.Struct({ issues: TitleListResponse })
export const OkResponse = Schema.Struct({ ok: Schema.Boolean })
const MessageBodyList = Schema.Array(Schema.Struct({ body: Schema.String })).pipe(Schema.mutable)
export const MessageBodiesResponse = Schema.Struct({ items: MessageBodyList })
export const RecordItemsResponse = Schema.Struct({ items: Schema.Array(JsonRecordResponse).pipe(Schema.mutable) })

class NativeJsonShapeError extends Data.TaggedError('NativeJsonShapeError')<
  Readonly<{ message: string; status?: number }>
> {}

export const readNativeJson = async function readNativeJson<S extends Schema.Constraint>(
  response: Pick<Response, 'json' | 'status'>,
  schema: S,
): Promise<S['Type']> {
  const body: unknown = await response.json()
  if (!Schema.is(schema)(body)) {
    throw new NativeJsonShapeError({
      message: `Native API response does not match the expected JSON shape (HTTP ${String(response.status)}).`,
      status: response.status,
    })
  }
  return body
}

export const readNativeMcpResultText = function readNativeMcpResultText(
  result: typeof RpcTextResponse.Type.result | undefined,
): string {
  const text = result?.content[0]?.text
  if (!Predicate.isString(text)) {
    throw new NativeJsonShapeError({ message: 'Expected the native MCP result to contain a first text item.' })
  }
  return text
}

export const parseNativeMcpText = function parseNativeMcpText<S extends Schema.Constraint>(
  text: string,
  schema: S,
): S['Type'] {
  const body: unknown = JSON.parse(text)
  if (!Schema.is(schema)(body)) {
    throw new NativeJsonShapeError({ message: 'MCP response text does not match the expected JSON shape.' })
  }
  return body
}
