import { String } from 'effect'

export const parseStoryPoints = function parseStoryPoints(value: string): number | null {
  if (String.isEmpty(value)) {
    return null
  }
  const num = parseFloat(value)
  if (Number.isNaN(num)) {
    return null
  }
  return num
}
