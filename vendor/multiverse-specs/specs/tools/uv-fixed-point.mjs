/** Exact decimal-source lowering for SPEC_UV_FIXED_POINT §4. Never route native text through Number. */
const SCALE = 1n << 32n
const MIN = -(1n << 63n)
const MAX = (1n << 63n) - 1n
const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/

/** Return the canonical signed i64 Q32.32 quantum as a decimal string for UVD JSON. */
export function quantizeFixed64Decimal(source) {
  if (typeof source !== 'string' || source.length > 256) {
    throw new TypeError('fixed64 source must be a bounded decimal string')
  }
  const match = DECIMAL.exec(source)
  if (match === null) throw new TypeError('fixed64 source is not a decimal')
  const fractional = match[3] ?? match[4] ?? ''
  const digits = `${match[2] ?? ''}${fractional}`.replace(/^0+/, '')
  const exponent = Number(match[5] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 256) {
    throw new RangeError('fixed64 decimal exponent exceeds the input budget')
  }
  if (digits.length === 0) return '0'
  if (digits.length > 128) throw new RangeError('fixed64 source exceeds the decimal input budget')
  const shift = exponent - fractional.length
  let numerator = BigInt(digits) * SCALE
  let quantum
  if (shift >= 0) {
    quantum = numerator * 10n ** BigInt(shift)
  } else {
    const denominator = 10n ** BigInt(-shift)
    const quotient = numerator / denominator
    const remainder = numerator % denominator
    const twice = remainder * 2n
    quantum = quotient + (twice > denominator || (twice === denominator && quotient % 2n !== 0n) ? 1n : 0n)
  }
  if (match[1] === '-') quantum = -quantum
  if (quantum < MIN || quantum > MAX) throw new RangeError('fixed64 quantum exceeds signed i64')
  return quantum.toString()
}
