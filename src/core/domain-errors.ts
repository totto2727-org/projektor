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
  HTTP_CONFLICT,
  HTTP_NOT_FOUND,
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

/**
 * Map known domain errors to the public fields documented by the RPC contract.
 *
 * @param {unknown} error The failure from the domain operation.
 * @returns {unknown} A public failure for a known domain error, or the original value for the RPC boundary to handle.
 */
export const publicDomainFailure = function publicDomainFailure(error: unknown): unknown {
  if (error instanceof ValidationError) {
    return coreFailure(HTTP_BAD_REQUEST, error.message, { kind: error.kind, details: jsonDetails(error.issues) })
  }
  if (error instanceof NotFoundError || error instanceof ConflictError) {
    return coreFailure(error instanceof NotFoundError ? HTTP_NOT_FOUND : HTTP_CONFLICT, error.message, {
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
