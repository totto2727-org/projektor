import { Schema } from 'effect'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from '#contracts/errors.ts'
import {
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_UNSUPPORTED_MEDIA_TYPE,
} from '#contracts/http-status.ts'

import { coreFailure } from './contract.ts'

const jsonDetails = function jsonDetails(input: unknown): Schema.JsonObject | undefined {
  try {
    return Schema.decodeUnknownSync(Schema.JsonObject)(input)
  } catch {
    return undefined
  }
}

/** Explicitly documented domain data, never arbitrary Error properties or diagnostics. */
export const publicDomainFailure = function publicDomainFailure(error: unknown): unknown {
  if (error instanceof ValidationError) {
    return coreFailure(HTTP_BAD_REQUEST, error.message, { kind: error.kind, details: jsonDetails(error.issues) })
  }
  if (error instanceof NotFoundError || error instanceof ConflictError) {
    return coreFailure(error instanceof NotFoundError ? 404 : 409, error.message, {
      kind: error.kind,
      ...(error.details ? { details: jsonDetails(error.details) } : {}),
    })
  }
  if (error instanceof ForbiddenError) {
    return coreFailure(HTTP_FORBIDDEN, error.message, { kind: error.kind })
  }
  if (error instanceof PayloadTooLargeError) {
    return coreFailure(HTTP_PAYLOAD_TOO_LARGE, error.message, { kind: error.kind })
  }
  if (error instanceof UnsupportedMediaTypeError) {
    return coreFailure(HTTP_UNSUPPORTED_MEDIA_TYPE, error.message, { kind: error.kind })
  }
  return error
}
