import { Data, Redacted } from 'effect'

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
