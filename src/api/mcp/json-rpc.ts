import { Option } from 'effect'

export const JSON_RPC_VERSION = '2.0'
export const JSON_RPC_PARSE_ERROR = -32_700
export const JSON_RPC_INVALID_REQUEST = -32_600
export const JSON_RPC_METHOD_NOT_FOUND = -32_601
export const JSON_RPC_INVALID_PARAMS = -32_602
export const JSON_RPC_INSUFFICIENT_SCOPE = -32_003

type JsonRpcHeader = Readonly<{ id: unknown; jsonrpc: typeof JSON_RPC_VERSION }>
type JsonRpcResult = JsonRpcHeader & Readonly<{ result: unknown }>
type JsonRpcErrorDetails = Readonly<{ code: number; data?: unknown; message: string }>
type JsonRpcError = JsonRpcHeader & Readonly<{ error: JsonRpcErrorDetails }>

const version = { jsonrpc: JSON_RPC_VERSION } as const

const header = function header(id: unknown): JsonRpcHeader {
  return { ...version, id }
}

export const jsonRpcResult = function jsonRpcResult(id: unknown, result: unknown): JsonRpcResult {
  return { ...header(id), result }
}

export const jsonRpcError = function jsonRpcError(id: unknown, details: JsonRpcErrorDetails): JsonRpcError {
  const { code, data, message } = details
  const error = { code, message }
  // JSON-RPC omits error.data when the error has no structured details.
  const payload = Option.fromUndefinedOr(data)
  return { ...header(id), error: Option.isSome(payload) ? { ...error, data: payload.value } : error }
}
