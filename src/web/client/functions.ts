'use client'

import type { ActionResult } from '@/function-result.ts'

/** A safe expected domain failure, without exposing an HTTP request interface. */
export class FunctionError extends Error {
  public readonly status: number
  public constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'FunctionError'
  }
}

/**
 * Decode a domain outcome after directly calling the relevant ServerFn.
 *
 * @param {ActionResult<T>} result The domain result returned by the server function.
 * @returns {T} The successful payload. A reported domain failure throws a FunctionError.
 */
export const unwrapResult = function unwrapResult<T>(result: ActionResult<T>): T {
  if (!result.ok) {
    throw new FunctionError(result.status, result.message)
  }
  return result.value
}
