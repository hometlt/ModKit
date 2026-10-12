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
})
