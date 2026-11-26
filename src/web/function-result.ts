type ActionFailure<Status extends number, Message extends string> = Readonly<{
  ok: false
  status: Status
  message: Message
}>

/** Serializable domain-operation outcomes shared by ServerFns and their callers. */
export type ActionResult<T> = { readonly ok: true; readonly value: T } | ActionFailure<number, string>

export const actionFailure = function actionFailure<Status extends number, Message extends string>(
  status: Status,
  message: Message,
): ActionFailure<Status, Message> {
  // oxlint-disable-next-line eslint/sort-keys -- React Server Function responses retain the existing field order.
  return { ok: false, status, message }
}
