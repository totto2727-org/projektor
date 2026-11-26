import { Predicate } from 'effect'

import { formatTimestampDate } from '@/features/timestamp.ts'

const THUMBS_UP_THRESHOLD = 0
const MIN_STAR_RATING = 0
const MAX_STAR_RATING = 5

export const ratingDisplay = function ratingDisplay(rating: number | null, scale: string | null): string {
  if (Predicate.isNullish(rating)) {
    return '—'
  }
  if (scale === 'thumbs') {
    return rating > THUMBS_UP_THRESHOLD ? '👍' : '👎'
  }
  return '★'.repeat(Math.max(MIN_STAR_RATING, Math.min(MAX_STAR_RATING, rating)))
}

export const formatDate = function formatDate(ts: number): string {
  return formatTimestampDate(ts)
}
