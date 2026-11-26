import { Predicate } from 'effect'

export const formatTokenScopes = function formatTokenScopes(raw: string): string {
  let scopes: unknown
  try {
    scopes = JSON.parse(raw)
  } catch {
    return '–'
  }
  if (!Array.isArray(scopes)) {
    return '–'
  }
  if (scopes.includes('*')) {
    return 'Full access (*)'
  }
  if (scopes.includes('write')) {
    return 'Read + Write'
  }
  if (scopes.includes('read')) {
    return 'Read-only'
  }
  return scopes.filter((value): value is string => Predicate.isString(value)).join(', ') || '–'
}
