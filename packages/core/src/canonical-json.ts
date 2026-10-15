/**
 * Canonical JSON serialization (lab decision L6; consumers: emitted schemas, locks).
 * Byte-stable: object keys sorted by UTF-8 byte order, 2-space indent, LF, trailing
 * newline. Non-serializable values throw a structured error instead of drifting.
 */

import { ModkitError } from './errors.js'
import { compareUtf8 } from './ordering.js'

function wellFormed(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('JCS cannot contain a lone surrogate')
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('JCS cannot contain a lone surrogate')
  }
}

function render(value: unknown, indent: string, depth: number, path: string, jcs = false, ancestors = new Set<object>()): string {
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
      if (jcs) wellFormed(value)
      return JSON.stringify(value)
    case 'object':
      break
    default:
      throw new ModkitError({
        code: 'x3.core/non-canonical-value',
        message: `${typeof value} is not canonical-JSON serializable at ${path}`,
      })
  }
  if (jcs) {
    if (depth > 256) throw new RangeError('JCS document is too deep')
    if (ancestors.has(value)) throw new TypeError('JCS cannot contain cycles')
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new TypeError('JCS requires plain JSON objects')
    ancestors.add(value)
  }
  try {
  const pad = indent.repeat(depth + 1)
  const closePad = indent.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = Array.from(
      value,
      (item, i) => pad + render(item, indent, depth + 1, `${path}[${i}]`, jcs, ancestors),
    )
    return jcs ? `[${items.join(',')}]` : `[\n${items.join(',\n')}\n${closePad}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter(key => jcs || record[key] !== undefined)
    .sort(jcs ? undefined : compareUtf8)
  if (keys.length === 0) return '{}'
  const entries = keys.map(key => {
    if (jcs) {
      wellFormed(key)
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) throw new TypeError('JCS rejects accessors')
    }
    return `${pad}${JSON.stringify(key)}:${jcs ? '' : ' '}${render(record[key], indent, depth + 1, `${path}.${key}`, jcs, ancestors)}`
  })
  return jcs ? `{${entries.join(',')}}` : `{\n${entries.join(',\n')}\n${closePad}}`
  } finally { if (jcs) ancestors.delete(value) }
}

export function canonicalJsonStringify(value: unknown, options?: Readonly<{ profile: 'jcs' }>): string {
  return options?.profile === 'jcs' ? render(value, '', 0, '$', true) : `${render(value, '  ', 0, '$')}\n`
}

/** Strict JSON document read: the platform parser owns syntax; a token scan rejects ambiguous
 * object keys (including escaped aliases) before callers issue a canonical identity. */
export function parseJsonDocument(text: string, maxDepth = 256): unknown {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) throw new RangeError('invalid JSON depth budget')
  const value: unknown = JSON.parse(text)
  const stack: (Set<string> | undefined)[] = []
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]]/gu
  for (const token of text.matchAll(tokens)) {
    const word = token[0]
    if (word === '{' || word === '[') {
      if (stack.length >= maxDepth) throw new RangeError('JSON document exceeds its depth budget')
      stack.push(word === '{' ? new Set<string>() : undefined)
    } else if (word === '}' || word === ']') stack.pop()
    else {
      const decoded = JSON.parse(word) as string
      wellFormed(decoded)
      let after = token.index + word.length
      while (/\s/u.test(text[after] ?? '') && after < text.length) after += 1
      if (text[after] === ':') {
        const keys = stack.at(-1)
        if (keys === undefined || keys.has(decoded)) throw new TypeError(`duplicate JSON object key ${JSON.stringify(decoded)}`)
        keys.add(decoded)
      }
    }
  }
  return value
}
