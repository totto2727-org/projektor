import { Predicate } from 'effect'

import { formatTimestampDate } from '@/features/timestamp.ts'

export const ratingDisplay = function ratingDisplay(rating: number | null, scale: string | null): string {
  if (Predicate.isNullish(rating)) {
    return '—'
  }
  if (scale === 'thumbs') {
    return rating > 0 ? '👍' : '👎'
  }
  return '★'.repeat(Math.max(0, Math.min(5, rating)))
}

export const formatDate = function formatDate(ts: number): string {
  return formatTimestampDate(ts)
}
