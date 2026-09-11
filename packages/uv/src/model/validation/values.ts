import type { JsonObject, JsonValue } from '@modkit/sdk'

export function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as JsonObject
}

export function field(value: unknown, key: string): JsonValue | undefined {
  // Uninterpreted glTF extras may be any JSON value, including scalars and arrays.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as JsonObject)[key]
}

export function array(value: unknown, key: string): readonly JsonValue[] {
  const candidate = field(value, key)
  return Array.isArray(candidate) ? candidate : []
}

export function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

export function finiteArray(value: unknown, length: number): value is readonly number[] {
  return Array.isArray(value) && value.length === length && value.every(finite)
}

export function oneOf(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value)
}

export function safeIndex(value: unknown, length: number, label: string): number {
  if (!integer(value) || value < 0 || value >= length)
    throw new RangeError(`${label} index is outside the UVM document`)
  return value
}
