/** Serializable domain-operation outcomes shared by ServerFns and their callers. */
export type ActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly message: string }
