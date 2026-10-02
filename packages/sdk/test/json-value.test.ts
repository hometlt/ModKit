import { expect, it } from 'vitest'
import { isJsonValue } from '../src/index.js'

it('takes JSON data and nothing else', () => {
  expect(isJsonValue({ a: [1, 'two', null, true, { b: 0.5 }] })).toBe(true)
  expect(isJsonValue(Object.create(null))).toBe(true)
  for (const value of [Number.NaN, Infinity, undefined, () => 1, new Map(), new Date(0), 1n])
    expect(isJsonValue(value)).toBe(false)
  expect(isJsonValue({ nested: { deeper: [undefined] } })).toBe(false)
  // nested at most maxDepth levels below the value
  const deep = (levels: number): unknown => (levels === 0 ? 1 : [deep(levels - 1)])
  expect(isJsonValue(deep(64))).toBe(true)
  expect(isJsonValue(deep(65))).toBe(false)
  expect(isJsonValue(deep(3), 2)).toBe(false)
})
