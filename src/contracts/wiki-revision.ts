import { Predicate } from 'effect'

export const isWikiRevisionSpecified: typeof Predicate.isNotUndefined = function isWikiRevisionSpecified(revision) {
  // oxlint-disable-next-line rules/prefer-is-nullish -- Null requires no current revision. Undefined leaves the precondition unset.
  return Predicate.isNotUndefined(revision)
}
