import type { JsonObject, JsonValue } from '@modkit/sdk'

export type JsonEdit =
  | { readonly op: 'add' | 'replace'; readonly path: string; readonly value: JsonValue }
  | { readonly op: 'remove'; readonly path: string }

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new TypeError('JSON Pointer target does not exist')
  return value
}

/** Immutable, prototype-safe JSON Pointer edit shared by structured codecs. */
export function applyJsonEdit(root: JsonObject, edit: JsonEdit, maxDepth: number): JsonObject {
  if (edit.op !== 'add' && edit.op !== 'replace' && edit.op !== 'remove')
    throw new TypeError('unsupported JSON edit')
  if (edit.path !== '' && !edit.path.startsWith('/')) throw new TypeError('invalid JSON Pointer')
  const tokens =
    edit.path === ''
      ? []
      : edit.path
          .slice(1)
          .split('/', maxDepth + 1)
          .map(token => {
            if (/~(?:[^01]|$)/u.test(token)) throw new TypeError('invalid JSON Pointer escape')
            return token.replace(/~1/gu, '/').replace(/~0/gu, '~')
          })
  if (tokens.length > maxDepth) throw new RangeError('JSON Pointer exceeds maxDepth')
  const visit = (value: JsonValue, depth: number): JsonValue => {
    if (depth === tokens.length) {
      if (edit.op === 'remove') throw new TypeError('cannot remove the JSON document root')
      return edit.value
    }
    const key = required(tokens[depth])
    const last = depth === tokens.length - 1
    if (Array.isArray(value)) {
      if (!(last && edit.op === 'add' && key === '-') && !/^(0|[1-9][0-9]*)$/u.test(key))
        throw new TypeError('invalid JSON Pointer array index')
      const index = key === '-' ? value.length : Number(key)
      const inserting = last && edit.op === 'add'
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length + (inserting ? 1 : 0))
        throw new RangeError('JSON Pointer array index is out of bounds')
      const result: JsonValue[] = [...value]
      if (last && edit.op === 'remove') result.splice(index, 1)
      else if (inserting) result.splice(index, 0, edit.value)
      else result[index] = visit(required(result[index]), depth + 1)
      return Object.freeze(result)
    }
    if (value === null || typeof value !== 'object')
      throw new TypeError('JSON Pointer traverses a scalar')
    const object = value as JsonObject
    if (!Object.hasOwn(object, key) && !(last && edit.op === 'add'))
      throw new TypeError('JSON Pointer target does not exist')
    const entries = Object.entries(object).filter(
      ([name]) => !(last && edit.op === 'remove' && name === key),
    )
    if (!(last && edit.op === 'remove')) {
      const replacement =
        last && edit.op === 'add' ? edit.value : visit(required(object[key]), depth + 1)
      const index = entries.findIndex(([name]) => name === key)
      if (index < 0) entries.push([key, replacement])
      else entries[index] = [key, replacement]
    }
    return Object.freeze(Object.fromEntries(entries))
  }
  const result = visit(root, 0)
  if (result === null || typeof result !== 'object' || Array.isArray(result))
    throw new TypeError('JSON document root must remain an object')
  return result as JsonObject
}
