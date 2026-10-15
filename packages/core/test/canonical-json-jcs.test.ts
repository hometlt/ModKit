import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { canonicalJsonStringify, parseJsonDocument } from '../src/canonical-json.js'

it('matches the published RFC8785 numeric and UTF16-key vectors without changing the default format', async () => {
  const vectors = JSON.parse(await readFile(new URL('../../../vendor/multiverse-specs/specs/conformance/uvp-json-artifact/vectors.json', import.meta.url), 'utf8')) as { jcs: { value: unknown; canonicalText: string }[] }
  for (const vector of vectors.jcs) expect(canonicalJsonStringify(vector.value, { profile: 'jcs' })).toBe(vector.canonicalText)
  expect(canonicalJsonStringify({ b: 1, a: undefined })).toBe('{\n  "b": 1\n}\n')
})

it('rejects non-JCS inputs, sparse arrays, lone surrogates, cycles and accessors', () => {
  const cycle: Record<string, unknown> = {}; cycle['self'] = cycle
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter was invoked') } })
  for (const input of [NaN, Infinity, '\ud800', { ['\udc00']: 1 }, undefined, new Date(), { missing: undefined }, Array(1), cycle])
    expect(() => canonicalJsonStringify(input, { profile: 'jcs' })).toThrow()
  expect(() => canonicalJsonStringify(accessor, { profile: 'jcs' })).toThrow('accessors')
  const shared = { number: 1 }
  expect(canonicalJsonStringify([shared, shared], { profile: 'jcs' })).toBe('[{"number":1},{"number":1}]')
})

it('rejects repeated JSON object keys including escaped aliases at any depth and retains safe prototype-named keys', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[{"nested":{"x":1,"x":2}}]', '{"a":[{"z":0,"z":1}]}'])
    expect(() => parseJsonDocument(text)).toThrow('duplicate JSON object key')
  expect(parseJsonDocument('{"a":1,"nested":{"a":2},"array":["[{}]",{"a":3}]}')).toEqual({ a: 1, nested: { a: 2 }, array: ['[{}]', { a: 3 }] })
  const value = parseJsonDocument('{"__proto__":{"x":1},"constructor":2}')
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
  expect(Object.hasOwn(value as object, '__proto__')).toBe(true)
})

it('enforces string Unicode and nesting bounds while the native parser owns JSON syntax', () => {
  for (const text of ['"\\ud800"', '{"\\udc00":0}', '{"trailing":1,}', '{"a": /* comment */ 1}', '{"a":1} garbage'])
    expect(() => parseJsonDocument(text)).toThrow()
  expect(() => parseJsonDocument('[[[0]]]', 2)).toThrow('depth budget')
  expect(parseJsonDocument('[[0]]', 2)).toEqual([[0]])
  expect(parseJsonDocument('{"a\\\"b":1,"brace}":"value:after"}')).toEqual({ 'a"b': 1, 'brace}': 'value:after' })
})
