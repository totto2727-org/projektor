import { Data, Redacted } from 'effect'

export type ZodFlattenOutput = {
  formErrors: string[]
  fieldErrors: Record<string, string[] | undefined>
}

export abstract class ServiceError extends Error {
  abstract readonly kind: string
}

export class ValidationError extends ServiceError {
  readonly issues: ZodFlattenOutput
  readonly kind = 'validation' as const
  constructor(issues: ZodFlattenOutput) {
    super('Validation failed')
    this.issues = issues
  }
}

export class NotFoundError extends ServiceError {
  readonly details?: Record<string, unknown>
  readonly kind = 'not_found' as const
  constructor(message = 'Not found', details?: Record<string, unknown>) {
    super(message)
    this.details = details
  }
}

export class ForbiddenError extends ServiceError {
  readonly kind = 'forbidden' as const
  constructor(message = 'Forbidden') {
    super(message)
  }
}

export class ConflictError extends ServiceError {
  readonly details?: Record<string, unknown>
  readonly kind = 'conflict' as const
  constructor(message = 'Conflict', details?: Record<string, unknown>) {
    super(message)
    this.details = details
  }
}

export class PayloadTooLargeError extends ServiceError {
  readonly kind = 'payload_too_large' as const
  constructor(message = 'Payload too large') {
    super(message)
  }
}

export class UnsupportedMediaTypeError extends ServiceError {
  readonly kind = 'unsupported_media_type' as const
  constructor(message = 'Unsupported media type') {
    super(message)
  }
}

export type ApiFailureKind = 'configuration' | 'request' | 'network' | 'http' | 'redirect' | 'json' | 'schema'

/** Display only message/status. Diagnostic causes stay structured and redacted. */
export class ApiError extends Data.TaggedError('ApiError')<{
  readonly kind: ApiFailureKind
  readonly status: number
  readonly message: string
  readonly cause?: Redacted.Redacted<unknown>
  readonly details?: Readonly<Record<string, unknown>>
}> {
  constructor(
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
      ...(details === undefined ? {} : { details }),
    })
  }
}

export class ScopeError extends Data.TaggedError('ScopeError')<{
  readonly status: 400 | 403 | 404
  readonly message: string
}> {
  constructor(status: 400 | 403 | 404, message: string) {
    super({ status, message })
  }
}

/** Map diagnostics only. Response decoding stays at each operation's concrete schema. */
export function responseError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause
  return new ApiError('schema', 502, 'The API returned an unexpected response.', cause)
}
