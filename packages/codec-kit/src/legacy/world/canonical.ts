/** Internal World v0 canonical-value vocabulary. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue }

const encoder = new TextEncoder()
const numberScratch = new DataView(new ArrayBuffer(8))

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

/** UTF-8 ordering with a code-unit tie-break for ill-formed UTF-16 input. */
export function compareCanonicalKeys(left: string, right: string): number {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!
    if (difference !== 0) return difference
  }
  return leftBytes.length - rightBytes.length || compareCodeUnits(left, right)
}

function numberBits(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError('World v0 canonical values cannot contain NaN or infinity')
  }
  numberScratch.setFloat64(0, value === 0 ? 0 : value, false)
  return `${numberScratch.getUint32(0, false).toString(16).padStart(8, '0')}${numberScratch
    .getUint32(4, false)
    .toString(16)
    .padStart(8, '0')}`
}

function encodeCanonical(value: CanonicalValue, ancestors: Set<object>): string {
  if (value === null) return '["null"]'
  if (typeof value === 'boolean') return `["boolean",${value ? 'true' : 'false'}]`
  if (typeof value === 'number') return `["number","${numberBits(value)}"]`
  if (typeof value === 'string') return `["string",${JSON.stringify(value)}]`
  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported World v0 canonical value: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new TypeError('World v0 canonical values cannot contain cycles')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return `["array",[${value.map(entry => encodeCanonical(entry, ancestors)).join(',')}]]`
    }
    const record = value as Readonly<Record<string, CanonicalValue>>
    const entries = Object.keys(record)
      .sort(compareCanonicalKeys)
      .map(key => `[${JSON.stringify(key)},${encodeCanonical(record[key]!, ancestors)}]`)
    return `["object",[${entries.join(',')}]]`
  } finally {
    ancestors.delete(value)
  }
}

/** Canonical, type-preserving text used only as the byte input to proof roots. */
export function canonicalStringify(value: CanonicalValue): string {
  return encodeCanonical(value, new Set())
}

export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return encoder.encode(canonicalStringify(value))
}

