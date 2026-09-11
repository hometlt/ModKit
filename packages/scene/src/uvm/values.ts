import type { JsonObject, JsonValue } from '@modkit/sdk'

export function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as JsonObject
}

/** Read a known metadata key without assigning meaning to other JSON extras. */
export function field(value: unknown, key: string): JsonValue | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as JsonObject)[key]
}

export function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function string(value: unknown, label: string): string {
  if (!nonBlank(value)) throw new TypeError(`UVM ${label} must be a nonempty string`)
  return value
}

export function array(value: unknown, key: string): readonly JsonValue[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  const candidate = (value as JsonObject)[key]
  return Array.isArray(candidate) ? candidate : []
}

export function safeIndex(value: unknown, length: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`)
  return value
}

export function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new TypeError(`missing UVM ${label}`)
  return value
}

export function finiteArray(value: unknown, length: number): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(item => typeof item === 'number' && Number.isFinite(item))
  )
}

export function vector3(value: unknown): readonly [number, number, number] {
  if (!finiteArray(value, 3))
    throw new TypeError('UVM node TRS must contain finite VEC3/VEC4 values')
  return [required(value[0], 'x'), required(value[1], 'y'), required(value[2], 'z')]
}

export function vector4(value: unknown): readonly [number, number, number, number] {
  if (!finiteArray(value, 4))
    throw new TypeError('UVM node TRS must contain finite VEC3/VEC4 values')
  return [
    required(value[0], 'x'),
    required(value[1], 'y'),
    required(value[2], 'z'),
    required(value[3], 'w'),
  ]
}
