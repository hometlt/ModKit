export { byteView, ascii } from '../binary.js'

export function clamp8(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function normalizedSampleToByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value >= 0 && value <= 1 ? clamp8(value * 255) : clamp8(value)
}

export function halfFloatToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}
