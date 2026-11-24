const BYTES_PER_KIBIBYTE = 1024
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE
const FRACTION_DIGITS = 1

export const formatBytes = function formatBytes(bytes: number): string {
  if (bytes < BYTES_PER_KIBIBYTE) {
    return `${bytes} B`
  }
  if (bytes < BYTES_PER_MEBIBYTE) {
    return `${(bytes / BYTES_PER_KIBIBYTE).toFixed(FRACTION_DIGITS)} KB`
  }
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(FRACTION_DIGITS)} MB`
}
