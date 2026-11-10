import { Schema } from 'effect'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '../contracts/errors'
import { coreFailure } from './contract'

function jsonDetails(input: unknown): Schema.JsonObject | undefined {
  try {
    return Schema.decodeUnknownSync(Schema.JsonObject)(input)
  } catch {
    return undefined
  }
}

/** Explicitly documented domain data, never arbitrary Error properties or diagnostics. */
export function publicDomainFailure(error: unknown): unknown {
  if (error instanceof ValidationError) {
    return coreFailure(400, error.message, { kind: error.kind, details: jsonDetails(error.issues) })
  }
  if (error instanceof NotFoundError || error instanceof ConflictError) {
    return coreFailure(error instanceof NotFoundError ? 404 : 409, error.message, {
      kind: error.kind,
      ...(error.details ? { details: jsonDetails(error.details) } : {}),
    })
  }
  if (error instanceof ForbiddenError) return coreFailure(403, error.message, { kind: error.kind })
  if (error instanceof PayloadTooLargeError) return coreFailure(413, error.message, { kind: error.kind })
  if (error instanceof UnsupportedMediaTypeError) return coreFailure(415, error.message, { kind: error.kind })
  return error
}
