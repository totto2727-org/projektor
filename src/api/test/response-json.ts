import { Data, Schema } from 'effect'

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
export const SlugResponse = Schema.Struct({ slug: Schema.String })
export const SlugListResponse = Schema.Array(SlugResponse).pipe(Schema.mutable)
export const TitleListResponse = Schema.Array(Schema.Struct({ title: Schema.String })).pipe(Schema.mutable)
export const TokenLinkResponse = Schema.Struct({ token: Schema.String, url: Schema.String })
export const TokenResponse = Schema.Struct({ token: Schema.String })

class NativeJsonShapeError extends Data.TaggedError('NativeJsonShapeError')<
  Readonly<{ message: string; status: number }>
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
