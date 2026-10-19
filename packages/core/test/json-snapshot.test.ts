/** Tests the shared serialization owner: inert data, exact budgets and immutable copies. */
import { describe, expect, it } from 'vitest'
import { snapshotJson } from '../src/json-snapshot.js'

const budget = { maxDepth: 16, maxNodes: 4096, maxBytes: 65536, sortKeys: true }

describe('bounded JSON snapshots', () => {
  it('owns frozen copies, sorts keys and permits repeated non-cyclic values', () => {
    const shared = { b: 2, a: 1 }
    const result = snapshotJson({ z: shared, a: shared, omitted: undefined }, budget)
    shared.a = 9
    expect(JSON.stringify(result)).toBe('{"a":{"a":1,"b":2},"z":{"a":1,"b":2}}')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen((result as Record<string, unknown>).a)).toBe(true)
  })

  it('rejects getters on objects and arrays without executing them', () => {
    let calls = 0
    for (const value of [{}, [1]]) {
      Object.defineProperty(value, Array.isArray(value) ? '0' : 'x', {
        enumerable: true,
        get() {
          calls++
          return 1
        },
      })
      expect(() => snapshotJson(value, budget)).toThrow(/accessor/)
    }
    expect(calls).toBe(0)
  })

  it('refuses lossy values, holes, cycles and non-plain prototypes', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const value of [
      NaN,
      Infinity,
      1n,
      () => 0,
      [undefined],
      new Array(1),
      new Date(),
      cyclic,
    ]) {
      expect(() => snapshotJson(value, budget)).toThrow()
    }
    expect(snapshotJson(Object.assign(Object.create(null), { x: 1 }), budget)).toEqual({ x: 1 })
  })

  it('counts UTF-8, nodes and depth exactly and observes cancellation', () => {
    expect(snapshotJson('é', { ...budget, maxBytes: 4 })).toBe('é')
    expect(() => snapshotJson('é', { ...budget, maxBytes: 3 })).toThrow(/maxBytes/)
    expect(() => snapshotJson([1], { ...budget, maxNodes: 1 })).toThrow(/maxNodes/)
    expect(() => snapshotJson([1], { ...budget, maxDepth: 0 })).toThrow(/maxDepth/)
    const signal = AbortSignal.abort()
    expect(() => snapshotJson(null, budget, signal)).toThrow(/cancelled/)
  })

  it('reuses only its own immutable snapshots, with cancellation still observed', () => {
    const source = { z: [1, 2], a: { x: 3 } }
    const owned = snapshotJson(source, budget)
    expect(snapshotJson(owned, budget)).toBe(owned)
    source.z[0] = 9
    expect(snapshotJson(source, budget)).not.toEqual(owned)
    expect(() => snapshotJson(owned, budget, AbortSignal.abort())).toThrow(/cancelled/)

    const nested = { x: 1 }
    const foreign = Object.freeze({ nested })
    const copied = snapshotJson(foreign, budget)
    expect(copied).not.toBe(foreign)
    nested.x = 2
    expect(copied).toEqual({ nested: { x: 1 } })
    const getter = Object.freeze(Object.defineProperty({}, 'x', {
      enumerable: true, get: () => { throw new Error('getter executed') },
    }))
    expect(() => snapshotJson(getter, budget)).toThrow(/accessor/)
  })

  it('charges reused children per occurrence and preserves tighter-budget refusals', () => {
    const child = snapshotJson(Array.from({ length: 100 }, (_, i) => ({ z: i, a: 'é😀' })), budget)
    const owned = snapshotJson({ a: child, z: { nested: child } }, { ...budget, maxBytes: 100000 })
    const plain = JSON.parse(JSON.stringify(owned))
    const result = (value: unknown, limits: typeof budget) => {
      try { return ['ok', JSON.stringify(snapshotJson(value, limits))] }
      catch (error) { return [(error as Error).name, (error as Error).message] }
    }
    for (const maxDepth of [0, 1, 2, 3, 4, 16])
      for (const maxNodes of [0, 1, 2, 4, 100, 302, 604, 4096])
        for (const maxBytes of [0, 1, 2, 10, 1000, 65536]) {
          const limits = { ...budget, maxDepth, maxNodes, maxBytes }
          expect(result(owned, limits)).toEqual(result(plain, limits))
        }
  })

  it('does not reuse unsorted snapshots for a request with sorted keys', () => {
    const unsorted = snapshotJson({ z: { z: 1, a: 2 }, a: 3 }, { ...budget, sortKeys: false })
    expect(JSON.stringify(unsorted)).toBe('{"z":{"z":1,"a":2},"a":3}')
    const sorted = snapshotJson(unsorted, budget)
    expect(JSON.stringify(sorted)).toBe('{"a":3,"z":{"a":2,"z":1}}')
    expect(snapshotJson(sorted, budget)).toBe(sorted)
  })
})
