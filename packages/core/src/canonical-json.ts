/**
 * Canonical JSON serialization (lab decision L6; consumers: emitted schemas, locks).
 * Byte-stable: object keys sorted by UTF-8 byte order, 2-space indent, LF, trailing
 * newline. Non-serializable values throw a structured error instead of drifting.
 */

import { ModkitError } from './errors.js'
import { compareUtf8 } from './ordering.js'

function render(value: unknown, indent: string, depth: number, path: string): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ModkitError({
          code: 'x3.core/non-canonical-value',
          message: `non-finite number at ${path}`,
        })
      }
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object':
      break
    default:
      throw new ModkitError({
        code: 'x3.core/non-canonical-value',
        message: `${typeof value} is not canonical-JSON serializable at ${path}`,
      })
  }
  const pad = indent.repeat(depth + 1)
  const closePad = indent.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = Array.from(
      value,
      (item, i) => pad + render(item, indent, depth + 1, `${path}[${i}]`),
    )
    return `[\n${items.join(',\n')}\n${closePad}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort(compareUtf8)
  if (keys.length === 0) return '{}'
  const entries = keys.map(
    key =>
      `${pad}${JSON.stringify(key)}: ${render(record[key], indent, depth + 1, `${path}.${key}`)}`,
  )
  return `{\n${entries.join(',\n')}\n${closePad}}`
}

export function canonicalJsonStringify(value: unknown): string {
  return `${render(value, '  ', 0, '$')}\n`
}
