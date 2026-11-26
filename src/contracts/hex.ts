const HEXADECIMAL_RADIX = 16
const HEX_DIGITS_PER_BYTE = 2

export const encodeHexBytes = function encodeHexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(HEXADECIMAL_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')).join('')
}
