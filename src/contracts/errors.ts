import { Predicate, Data, Redacted } from 'effect'

import {
  type HTTP_BAD_REQUEST,
  type HTTP_FORBIDDEN,
  type HTTP_NOT_FOUND,
  HTTP_BAD_GATEWAY,
} from '#contracts/http-status.ts'

export interface ZodFlattenOutput {
  formErrors: string[]
  fieldErrors: Record<string, string[] | undefined>
}

export const validationIssues = function validationIssues(
  formErrors: ZodFlattenOutput['formErrors'],
  fieldErrors: ZodFlattenOutput['fieldErrors'],
): ZodFlattenOutput {
  // oxlint-disable-next-line eslint/sort-keys -- HTTP and JSON-RPC errors retain the existing order of these fields.
  return { formErrors, fieldErrors }
}

export abstract class ServiceError extends Error {
  public abstract get kind(): string
}

export class ValidationError extends ServiceError {
  public readonly issues: ZodFlattenOutput
  public readonly kind = 'validation' as const
  public constructor(issues: ZodFlattenOutput) {
    super('Validation failed')
    this.issues = issues
  }
}

export class NotFoundError extends ServiceError {
  public readonly details?: Record<string, unknown>
  public readonly kind = 'not_found' as const
  public constructor(message = 'Not found', details?: Record<string, unknown>) {
    super(message)
    this.details = details
  }
}

export class ForbiddenError extends ServiceError {
  public readonly kind = 'forbidden' as const
  public constructor(message = 'Forbidden') {
    super(message)
  }
}

export class ConflictError extends ServiceError {
  public readonly details?: Record<string, unknown>
  public readonly kind = 'conflict' as const
  public constructor(message = 'Conflict', details?: Record<string, unknown>) {
    super(message)
    this.details = details
  }
}

export class PayloadTooLargeError extends ServiceError {
  public readonly kind = 'payload_too_large' as const
  public constructor(message = 'Payload too large') {
    super(message)
  }
}

export class UnsupportedMediaTypeError extends ServiceError {
  public readonly kind = 'unsupported_media_type' as const
  public constructor(message = 'Unsupported media type') {
    super(message)
  }
}

export type ApiFailureKind = 'configuration' | 'request' | 'network' | 'http' | 'redirect' | 'json' | 'schema'

/** Display only message/status. Diagnostic causes stay structured and redacted. */
export class ApiError extends Data.TaggedError('ApiError')<
  Readonly<{
    kind: ApiFailureKind
    status: number
    message: string
    cause?: Redacted.Redacted<unknown>
    details?: Readonly<Record<string, unknown>>
  }>
> {
  public constructor(
    kind: ApiFailureKind,
    status: number,
    message: string,
    cause?: unknown,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super({
      kind,
      status,
      message,
      ...(cause === undefined ? {} : { cause: Redacted.make(cause) }),
      ...(Predicate.isNullish(details) ? {} : { details }),
    })
  }
}

export class ScopeError extends Data.TaggedError('ScopeError')<
  Readonly<{
    status: typeof HTTP_BAD_REQUEST | typeof HTTP_FORBIDDEN | typeof HTTP_NOT_FOUND
    message: string
  }>
> {
  public constructor(status: typeof HTTP_BAD_REQUEST | typeof HTTP_FORBIDDEN | typeof HTTP_NOT_FOUND, message: string) {
    super({ status, message })
  }
}

/**
 * Map diagnostics from the operation's own concrete response decoder.
 *
 * @param {unknown} cause The error raised while reading or validating the response.
 * @returns {ApiError} The existing API error or a schema error that presents a generic response message.
 */
export const responseError = function responseError(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause
  }
  return new ApiError('schema', HTTP_BAD_GATEWAY, 'The API returned an unexpected response.', cause)
}
