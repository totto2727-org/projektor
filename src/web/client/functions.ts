'use client'

import type { ActionResult } from '../function-result'

/** A safe expected domain failure, without exposing an HTTP request interface. */
export class FunctionError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'FunctionError'
  }
}

/** Decode a domain outcome after directly calling the relevant ServerFn. */
export function unwrapResult<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new FunctionError(result.status, result.message)
  return result.value
}
