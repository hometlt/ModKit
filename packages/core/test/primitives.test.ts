import { describe, expect, it } from 'vitest'
import {
  canonicalJsonStringify,
  compareUtf8,
  diagnostic,
  DisposableStore,
  hasErrors,
  isCancellation,
  isModkitError,
  ModkitError,
  OperationCancelledError,
  OPERATION_DOMAINS,
  CONTAINER_EXTRACT_OPERATION_ID,
  SHARED_OPERATION_IDS,
  sortedUtf8,
  throwIfAborted,
  uniqueSortedUtf8,
} from '@modkit/core'

describe('ModkitError + diagnostics', () => {
  it('carries a qualified code, context and retryability, and serializes', () => {
    const error = new ModkitError({
      code: 'x3.demo/bad-input',
      message: 'bad input',
      context: { field: 'id' },
      retryability: 'conditional',
    })
    expect(isModkitError(error)).toBe(true)
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: 'x3.demo/bad-input',
      message: 'bad input',
      retryability: 'conditional',
      context: { field: 'id' },
    })
  })

  it('rejects non-qualified codes', () => {
    expect(() => new ModkitError({ code: 'notqualified', message: 'x' })).toThrow(TypeError)
  })

  it('diagnostics are data with severities', () => {
    const list = [
      diagnostic('warning', 'x3.demo/odd', 'odd'),
      diagnostic('error', 'x3.demo/broken', 'broken', ['spec', 0]),
    ]
    expect(hasErrors(list)).toBe(true)
    expect(list[1]?.path).toEqual(['spec', 0])
  })
})

describe('deterministic ordering (MK3/23 §9.9)', () => {
  it('keeps exported closed operation vocabularies immutable at runtime', () => {
    expect(CONTAINER_EXTRACT_OPERATION_ID).toBe('container.extract')
    expect(SHARED_OPERATION_IDS).toContain(CONTAINER_EXTRACT_OPERATION_ID)
    expect(SHARED_OPERATION_IDS).toContain('view.template')
    expect(() => (OPERATION_DOMAINS as unknown as string[]).push('evil')).toThrow(TypeError)
    expect(() => (SHARED_OPERATION_IDS as unknown as string[]).push('evil.run')).toThrow(TypeError)
  })

  it('sorts by UTF-8 bytes, not UTF-16 code units', () => {
    // U+FFFD encodes as EF BF BD; U+1F600 as F0 9F 98 80 — byte order puts FFFD first,
    // while UTF-16 code-unit comparison would put the surrogate pair first.
    expect(compareUtf8('�', '\u{1F600}')).toBeLessThan(0)
    expect('�' < '\u{1F600}').toBe(false) // documents the UTF-16 difference
    expect(compareUtf8('z', 'é')).toBeLessThan(0)
  })

  it('matches byte ordering even when an ASCII decision precedes a Unicode suffix', () => {
    const encoder = new TextEncoder()
    const values = ['', 'a', 'aa', 'aé', 'b😀', 'a\ud800', 'a\ud801', 'a�', 'é', '😀', '�']
    for (const left of values) {
      for (const right of values) {
        const a = encoder.encode(left)
        const b = encoder.encode(right)
        let expected = 0
        for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
          if (a[index] !== b[index]) {
            expected = (a[index] as number) < (b[index] as number) ? -1 : 1
            break
          }
        }
        if (expected === 0) {
          expected =
            a.length !== b.length
              ? a.length < b.length
                ? -1
                : 1
              : left < right
                ? -1
                : left > right
                  ? 1
                  : 0
        }
        expect(compareUtf8(left, right)).toBe(expected)
      }
    }
  })

  it('is shuffle-stable and deduplicates', () => {
    const input = ['b.trait', 'a.trait', 'b.trait', 'z.trait']
    const shuffled = ['z.trait', 'b.trait', 'a.trait', 'b.trait']
    expect(uniqueSortedUtf8(input)).toEqual(uniqueSortedUtf8(shuffled))
    expect(sortedUtf8(['b', 'a'])).toEqual(['a', 'b'])
  })
})

describe('canonical JSON (L6)', () => {
  it('is byte-stable across key insertion order and ends with LF', () => {
    const a = canonicalJsonStringify({ b: 1, a: { y: [1, 2], x: 'é' } })
    const b = canonicalJsonStringify({ a: { x: 'é', y: [1, 2] }, b: 1 })
    expect(a).toBe(b)
    expect(a.endsWith('\n')).toBe(true)
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"b"'))
  })

  it('is deterministic for distinct lone-surrogate keys with identical UTF-8 replacement bytes', () => {
    const first = canonicalJsonStringify({ ['\ud800']: 1, ['\ud801']: 2 })
    const reversed = canonicalJsonStringify({ ['\ud801']: 2, ['\ud800']: 1 })
    expect(first).toBe(reversed)
    expect(compareUtf8('\ud800', '\ud801')).not.toBe(0)
  })

  it('drops undefined properties and rejects non-serializable values', () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe(canonicalJsonStringify({ a: 1 }))
    expect(() => canonicalJsonStringify({ a: Number.NaN })).toThrow(ModkitError)
    expect(() => canonicalJsonStringify({ a: () => 1 })).toThrow(ModkitError)
    expect(() => canonicalJsonStringify(Array(1))).toThrow(ModkitError)
  })
})

describe('cancellation + lifecycle', () => {
  it('throwIfAborted throws a typed cancellation error', () => {
    const controller = new AbortController()
    expect(() => throwIfAborted(controller.signal)).not.toThrow()
    controller.abort(new Error('stop'))
    try {
      throwIfAborted(controller.signal)
      expect.unreachable()
    } catch (error) {
      expect(isCancellation(error)).toBe(true)
      expect((error as OperationCancelledError).retryability).toBe('safe')
    }
  })

  it('DisposableStore disposes in reverse order, idempotently, aggregating failures', async () => {
    const order: string[] = []
    const store = new DisposableStore()
    store.add({ dispose: () => void order.push('first') })
    store.add({
      dispose: () => {
        order.push('second')
        throw new Error('boom')
      },
    })
    store.add({ dispose: async () => void order.push('third') })
    await expect(store.dispose()).rejects.toThrow(ModkitError)
    expect(order).toEqual(['third', 'second', 'first'])
    await expect(store.dispose()).resolves.toBeUndefined() // idempotent
    expect(() => store.add({ dispose: () => undefined })).toThrow(ModkitError)
  })
})
