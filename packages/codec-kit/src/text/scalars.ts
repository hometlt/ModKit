import type { TextScalar, YamlNode } from '@modkit/sdk/text-data'
import { span } from './text.js'

export function scalar(value: unknown, raw = JSON.stringify(value)): TextScalar {
  if (value === null) return { kind: 'null', raw: 'null' }
  if (typeof value === 'boolean') return { kind: 'boolean', value, raw: String(value) }
  if (typeof value === 'string') return { kind: 'string', value, raw: raw ?? JSON.stringify(value) }
  if (typeof value === 'bigint')
    return { kind: 'integer', decimal: String(value), raw: String(value) }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { kind: 'integer', decimal: String(value), raw: raw ?? String(value) }
  }
  if (typeof value === 'number')
    return { kind: 'number', raw: raw ?? String(value), finiteValue: value }
  if (value instanceof Date)
    return { kind: 'date-time', iso: value.toISOString(), raw: raw ?? value.toISOString() }
  return { kind: 'string', value: String(value), raw: raw ?? String(value) }
}

export function plainNode(
  value: unknown,
  text: string,
  counters: { nodes: number; depth: number },
  depth = 0,
): YamlNode {
  counters.nodes += 1
  counters.depth = Math.max(counters.depth, depth)
  const range = span(text)
  if (Array.isArray(value)) {
    return {
      kind: 'sequence',
      items: value.map(item => plainNode(item, text, counters, depth + 1)),
      range,
    }
  }
  if (value && typeof value === 'object') {
    return {
      kind: 'mapping',
      pairs: Object.entries(value).map(([key, item]) => ({
        key: { kind: 'scalar', value: scalar(key), range },
        value: plainNode(item, text, counters, depth + 1),
      })),
      range,
    }
  }
  return { kind: 'scalar', value: scalar(value), range }
}
